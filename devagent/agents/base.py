"""Adapter interface every CLI coding agent must implement.

Adding a new agent (Gemini CLI, Codex CLI, Aider, ...) means writing ONE new
BaseAgent subclass and adding ONE line to agents/__init__.py:AGENTS. The
devagent core (main.py) never branches on which agent is running by name — it
only looks the name up in AGENTS and calls these two methods.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path


class BaseAgent(ABC):
    name: str

    @abstractmethod
    def build_command(
        self,
        prompt: str,
        project_path: Path,
        resume_session_id: str | None = None,
        approval_endpoint: dict | None = None,
    ) -> list[str]:
        """Return the argv to exec for one task run.

        Always a list of args, never a shell string — main.py runs this via
        asyncio.create_subprocess_exec(*argv), so the prompt (arbitrary,
        remote-supplied text) can never break out into a shell command.

        `resume_session_id` is the opaque id a previous call to `session_id()`
        on an earlier task in the same conversation returned (see
        docs/PROTOCOL.md's `task.start.resume_session_id` /
        `task.result.session_id`). Adapters that can't continue a prior
        conversation should just ignore it.

        `approval_endpoint`, when not None, is `{"port": int, "task_id": str}`
        for main.py's local approval bridge (see main.py's
        `_handle_approver_conn`): a loopback TCP server that turns one
        newline-JSON request into a `docs/PROTOCOL.md` `approval.request`/
        `approval.response` round trip with the phone. An adapter whose CLI
        has some way to gate risky tool calls on an external decision (a
        permission hook, a callback, ...) can point it at this endpoint
        instead of auto-approving/auto-denying such calls itself. Adapters
        without such a mechanism should just ignore it — that's the current
        default for every adapter but claude.py.
        """

    @abstractmethod
    def parse_event(self, line: str) -> dict | list[dict] | None:
        """Normalize one line of the process's stdout into log-event dict(s).

        Return None to swallow a line entirely (e.g. blank keep-alive
        output), a single dict for one event, or a list[dict] when one line
        legitimately expands into several (e.g. one assistant turn mixing a
        text block with a tool call — main.py sends each in order). Must
        never raise: a line this adapter can't make sense of should become a
        fallback event (e.g. {"kind": "raw", "text": line}), not an
        exception that kills the streaming loop.
        """

    def session_id(self) -> str | None:
        """Return an opaque id identifying the conversation just run, so a
        follow-up task.start can pass it back as `resume_session_id` to
        continue it. Called once, after the process has exited.

        A fresh agent instance is created per task (see main.py's
        `_handle_task_start`), so implementations may stash whatever they
        need on `self` during `build_command`/`parse_event` and read it back
        here. Default: no resumption support.
        """
        return None
