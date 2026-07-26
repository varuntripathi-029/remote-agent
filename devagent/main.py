"""DevAgent Remote — devagent core loop.

Runs on a laptop, dials OUT to the backend relay (reverse tunnel — see
docs/PROTOCOL.md), registers a device_id, and holds the connection open.
Drives whichever CLI agent a task.start message names via the adapter
registry in agents/ — this file never special-cases an agent by name beyond
that one lookup, so it stays agent-agnostic.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from pathlib import Path

import websockets
from websockets.exceptions import ConnectionClosed

import git_safety
from agents import AGENTS
from config import Config, ProjectAlreadyRegisteredError, load_config

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("devagent")

RECONNECT_MIN_DELAY_S = 1
RECONNECT_MAX_DELAY_S = 30
# How long to wait for a phone to answer an approval.request before denying
# it automatically — a bit under claude_approval_hook.py's own socket
# timeout so we're the one who produces the (clearer) timeout reason.
APPROVAL_TIMEOUT_S = 280


class Devagent:
    def __init__(self, config: Config):
        self.config = config
        self._project_locks: dict[str, asyncio.Lock] = {}
        # Set for the lifetime of the current backend connection (see run());
        # None while disconnected/reconnecting. Read by _handle_approver_conn
        # to know whether there's anywhere to send an approval.request.
        self._ws = None
        # Pending approval.request round trips, keyed by req_id — resolved by
        # _handle_message when the matching approval.response arrives, or by
        # _handle_approver_conn itself on timeout.
        self._pending_approvals: dict[str, asyncio.Future] = {}
        # Loopback port claude_approval_hook.py (or any future adapter's
        # equivalent) connects to; set once by _start_approval_bridge().
        self._approver_port: int | None = None

    def _lock_for(self, project_id: str) -> asyncio.Lock:
        if project_id not in self._project_locks:
            self._project_locks[project_id] = asyncio.Lock()
        return self._project_locks[project_id]

    async def run(self) -> None:
        """Connect, register, and process messages forever, reconnecting
        with exponential backoff if the backend connection drops."""
        await self._start_approval_bridge()

        delay = RECONNECT_MIN_DELAY_S
        while True:
            try:
                async with websockets.connect(self.config.backend_url) as ws:
                    await ws.send(json.dumps(
                        {"type": "register", "device_id": self.config.device_id}
                    ))
                    logger.info("registered with backend as device_id=%s", self.config.device_id)
                    delay = RECONNECT_MIN_DELAY_S  # reset backoff after a clean connect
                    self._ws = ws
                    await self._read_loop(ws)
            except (ConnectionClosed, OSError) as exc:
                logger.warning("backend connection lost (%s); reconnecting in %ss", exc, delay)
            finally:
                self._ws = None

            await asyncio.sleep(delay)
            delay = min(delay * 2, RECONNECT_MAX_DELAY_S)

    async def _start_approval_bridge(self) -> None:
        """Loopback-only TCP server that lets a running CLI agent's own
        permission mechanism (e.g. claude_approval_hook.py, run as a Claude
        Code PreToolUse hook — see agents/claude.py) turn a pending tool call
        into an approval.request/approval.response round trip with the
        phone, without needing to share this asyncio event loop directly:
        the hook runs as a separate OS process (a grandchild of this one, via
        the `claude` subprocess), so a socket is the simplest thing that
        works across that boundary."""
        server = await asyncio.start_server(
            self._handle_approver_conn, "127.0.0.1", 0
        )
        self._approver_server = server  # keep a reference so it isn't GC'd
        self._approver_port = server.sockets[0].getsockname()[1]
        logger.info("approval bridge listening on 127.0.0.1:%s", self._approver_port)

    async def _handle_approver_conn(self, reader, writer) -> None:
        req_id: str | None = None
        try:
            raw = await reader.readline()
            if not raw:
                return
            try:
                request = json.loads(raw.decode())
            except (ValueError, TypeError):
                await self._write_approver_response(writer, False, "malformed approval request")
                return

            task_id = request.get("task_id")
            tool_name = str(request.get("tool_name", "tool"))
            tool_input = request.get("tool_input") or {}

            ws = self._ws
            if ws is None:
                await self._write_approver_response(
                    writer, False, "devagent is not connected to the backend right now"
                )
                return

            req_id = str(uuid.uuid4())
            fut: asyncio.Future = asyncio.get_running_loop().create_future()
            self._pending_approvals[req_id] = fut
            await self._send(ws, {
                "type": "approval.request",
                "task_id": task_id,
                "req_id": req_id,
                "tool": tool_name,
                "input": tool_input,
            })

            try:
                allow = await asyncio.wait_for(fut, timeout=APPROVAL_TIMEOUT_S)
                await self._write_approver_response(writer, bool(allow), None)
            except asyncio.TimeoutError:
                await self._write_approver_response(
                    writer, False, "timed out waiting for approval from the phone"
                )
        except Exception:
            logger.exception("approval bridge: request handling failed")
            try:
                await self._write_approver_response(writer, False, "internal devagent error")
            except Exception:
                pass
        finally:
            if req_id is not None:
                self._pending_approvals.pop(req_id, None)
            writer.close()

    async def _write_approver_response(self, writer, allow: bool, reason: str | None) -> None:
        response = {"allow": allow}
        if reason:
            response["reason"] = reason
        writer.write((json.dumps(response) + "\n").encode())
        await writer.drain()

    async def _read_loop(self, ws) -> None:
        async for raw in ws:
            try:
                message = json.loads(raw)
            except (ValueError, TypeError):
                logger.warning("dropping non-JSON message from backend: %r", raw[:200])
                continue
            if not isinstance(message, dict):
                logger.warning("dropping non-object message from backend: %r", message)
                continue

            task = asyncio.create_task(self._handle_message(ws, message))
            task.add_done_callback(self._log_if_failed)

    def _log_if_failed(self, task: asyncio.Task) -> None:
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            logger.error("message handler crashed", exc_info=exc)

    async def _handle_message(self, ws, message: dict) -> None:
        msg_type = message.get("type")
        if msg_type == "projects.list":
            await self._handle_projects_list(ws, message)
        elif msg_type == "project.register":
            await self._handle_project_register(ws, message)
        elif msg_type == "task.start":
            await self._handle_task_start(ws, message)
        elif msg_type == "task.revert":
            await self._handle_task_revert(ws, message)
        elif msg_type == "approval.response":
            # TODO(approval): once the --permission-prompt-tool MCP seam
            # described in agents/claude.py exists, route this to whatever is
            # awaiting the matching req_id. Until then there is nothing
            # waiting on approvals (M0 auto-approves via acceptEdits), so
            # this is a documented no-op rather than an error.
            logger.info("received approval.response (no-op in M0): %r", message)
        else:
            logger.warning("unknown message type from backend: %r", msg_type)

    async def _send(self, ws, message: dict) -> None:
        await ws.send(json.dumps(message))

    async def _send_log(self, ws, task_id: str | None, data: dict) -> None:
        if task_id is None:
            logger.warning("dropping log with no task_id: %r", data)
            return
        await self._send(ws, {"type": "log", "task_id": task_id, "data": data})

    async def _send_error_log(self, ws, task_id: str | None, message: str) -> None:
        logger.warning("task %s: %s", task_id, message)
        await self._send_log(ws, task_id, {"kind": "error", "message": message})

    async def _handle_projects_list(self, ws, message: dict) -> None:
        # device_id in the request is who we already are (backend only ever
        # delivers phone->agent messages to the matching device); the reply
        # carries our own device_id so a phone that queried multiple devices
        # can tell which device this list belongs to (agent->phone messages
        # are broadcast to every connected phone in M0).
        projects_payload = []
        for project in self.config.projects.values():
            branch = await git_safety.current_branch(project.local_path)
            commit = await git_safety.last_commit_hash(project.local_path)
            remote = await git_safety.remote_url(project.local_path)
            entry = {
                "project_id": project.project_id,
                "display_name": project.display_name,
                "current_branch": branch,
                "last_commit_hash": commit,
            }
            if remote:
                entry["remote_url"] = remote
            projects_payload.append(entry)

        await self._send(ws, {
            "type": "projects",
            "device_id": self.config.device_id,
            "projects": projects_payload,
        })

    async def _handle_project_register(self, ws, message: dict) -> None:
        # Per aim.md §5, project registration is the allowlist boundary: this
        # runs the exact same validation manage_projects.py's CLI does (real
        # directory, real git repo, resolved to the repo root) before ever
        # adding anything a remote phone asked for to the registry.
        req_id = message.get("req_id")
        display_name = message.get("display_name")
        local_path_str = message.get("local_path")

        async def fail(error: str) -> None:
            await self._send(ws, {
                "type": "project.register.result",
                "req_id": req_id,
                "device_id": self.config.device_id,
                "ok": False,
                "error": error,
            })

        if not req_id or not display_name or not local_path_str:
            await fail(f"malformed project.register message: {message!r}")
            return

        local_path = Path(local_path_str).resolve()
        if not local_path.is_dir():
            await fail(f"{local_path} is not a directory on this laptop")
            return

        if not await git_safety.is_git_repo(local_path):
            await fail(f"{local_path} is not a git repository (run 'git init' there first)")
            return

        git_root = await git_safety.resolve_git_root(local_path)

        try:
            project = self.config.register_project(display_name, git_root)
        except ProjectAlreadyRegisteredError as exc:
            await fail(str(exc))
            return

        branch = await git_safety.current_branch(project.local_path)
        commit = await git_safety.last_commit_hash(project.local_path)
        await self._send(ws, {
            "type": "project.register.result",
            "req_id": req_id,
            "device_id": self.config.device_id,
            "ok": True,
            "project": {
                "project_id": project.project_id,
                "display_name": project.display_name,
                "current_branch": branch,
                "last_commit_hash": commit,
            },
        })

    async def _handle_task_start(self, ws, message: dict) -> None:
        task_id = message.get("task_id")
        project_id = message.get("project_id")
        agent_name = message.get("agent")
        prompt = message.get("prompt")
        resume_session_id = message.get("resume_session_id")

        if not task_id or not project_id or not agent_name or prompt is None:
            await self._send_error_log(ws, task_id, f"malformed task.start message: {message!r}")
            return

        # Security boundary: only ever touch paths in the project allowlist,
        # resolved locally from project_id — a phone never sends a path.
        project = self.config.resolve_project(project_id)
        if project is None:
            await self._send_error_log(ws, task_id, f"unregistered project_id: {project_id!r}")
            return

        agent_cls = AGENTS.get(agent_name)
        if agent_cls is None:
            await self._send_error_log(
                ws, task_id, f"unknown agent {agent_name!r}; available: {sorted(AGENTS)}"
            )
            return

        lock = self._lock_for(project_id)
        if lock.locked():
            await self._send_error_log(
                ws, task_id, f"a task is already running for project {project.display_name!r}"
            )
            return

        async with lock:
            await self._run_task(
                ws, task_id, project.local_path, agent_cls(), prompt, resume_session_id
            )

    async def _run_task(
        self,
        ws,
        task_id: str,
        project_path: Path,
        agent,
        prompt: str,
        resume_session_id: str | None = None,
    ) -> None:
        try:
            checkpoint_sha = await git_safety.checkpoint(project_path, task_id)
        except git_safety.NotAGitRepoError as exc:
            await self._send_error_log(ws, task_id, str(exc))
            return
        except git_safety.GitCommandError as exc:
            await self._send_error_log(ws, task_id, f"checkpoint failed: {exc}")
            return

        await self._send_log(ws, task_id, {"kind": "checkpoint", "checkpoint": checkpoint_sha})

        try:
            argv = agent.build_command(prompt, project_path, resume_session_id)
        except Exception as exc:
            await self._send_error_log(ws, task_id, f"failed to build agent command: {exc}")
            return

        try:
            await self._stream_process(ws, task_id, argv, project_path, agent)
        except Exception as exc:
            logger.exception("task %s: agent process failed", task_id)
            await self._send_error_log(ws, task_id, f"agent process failed: {exc}")
            return

        summary = await git_safety.summarize(project_path)
        await self._send(ws, {
            "type": "task.result",
            "task_id": task_id,
            "checkpoint": checkpoint_sha,
            "files": summary.files,
            "stat": summary.stat,
            "session_id": agent.session_id(),
        })

    async def _stream_process(
        self, ws, task_id: str, argv: list[str], project_path: Path, agent
    ) -> None:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            cwd=str(project_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        async def pump_stdout() -> None:
            assert proc.stdout is not None
            async for raw_line in proc.stdout:
                line = raw_line.decode(errors="replace").rstrip("\n")
                if not line:
                    continue
                try:
                    event = agent.parse_event(line)
                except Exception:
                    logger.exception("task %s: adapter parse_event raised", task_id)
                    event = {"kind": "raw", "text": line}
                if event is not None:
                    await self._send_log(ws, task_id, event)

        async def pump_stderr() -> None:
            assert proc.stderr is not None
            async for raw_line in proc.stderr:
                line = raw_line.decode(errors="replace").rstrip("\n")
                if line:
                    await self._send_log(ws, task_id, {"kind": "stderr", "text": line})

        await asyncio.gather(pump_stdout(), pump_stderr())
        await proc.wait()

    async def _handle_task_revert(self, ws, message: dict) -> None:
        task_id = message.get("task_id")
        project_id = message.get("project_id")
        checkpoint_sha = message.get("checkpoint")

        if not project_id or not checkpoint_sha:
            await self._send_error_log(ws, task_id, f"malformed task.revert message: {message!r}")
            return

        project = self.config.resolve_project(project_id)
        if project is None:
            await self._send_error_log(ws, task_id, f"unregistered project_id: {project_id!r}")
            return

        try:
            await git_safety.revert(project.local_path, checkpoint_sha)
        except git_safety.GitCommandError as exc:
            await self._send_error_log(ws, task_id, f"revert failed: {exc}")
            return

        await self._send_log(
            ws, task_id, {"kind": "revert", "status": "ok", "checkpoint": checkpoint_sha}
        )


def main() -> None:
    config = load_config()
    devagent = Devagent(config)
    asyncio.run(devagent.run())


if __name__ == "__main__":
    main()
