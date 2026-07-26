"""Adapter for the Claude Code CLI.

Example value of task.start's "agent" field that routes here: "claude". This
is the only file in the devagent allowed to know Claude Code's flags and
output format — main.py, git_safety.py, and docs/PROTOCOL.md stay completely
unaware of it.
"""

from __future__ import annotations

import json
import shlex
import shutil
import sys
from pathlib import Path

from .base import BaseAgent

# Colocated with this adapter since it speaks Claude Code's own PreToolUse
# hook JSON contract (see _build_approval_settings below and
# claude_approval_hook.py's module docstring).
_APPROVAL_HOOK_SCRIPT = Path(__file__).with_name("claude_approval_hook.py")


class ClaudeCodeAgent(BaseAgent):
    name = "claude"

    def __init__(self) -> None:
        self._session_id: str | None = None

    def build_command(
        self,
        prompt: str,
        project_path: Path,
        resume_session_id: str | None = None,
        approval_endpoint: dict | None = None,
    ) -> list[str]:
        # shutil.which resolves the real target of PATH shims (claude.cmd on
        # Windows) so create_subprocess_exec can run it directly with
        # shell=False.
        executable = shutil.which("claude")
        if executable is None:
            raise FileNotFoundError("'claude' CLI not found on PATH")

        argv = [
            executable,
            "-p", prompt,
            "--output-format", "stream-json",
            "--verbose",
            # acceptEdits auto-approves the Edit/Write/NotebookEdit tools, so
            # routine file edits never round-trip to the phone. It would also
            # auto-approve some filesystem ops issued *through* Bash (mkdir,
            # rm, mv, cp, sed) — but the PreToolUse hook below runs before
            # permission-mode is even consulted (hooks are step 1 of Claude
            # Code's evaluation order) and, when wired in, decides every Bash
            # call itself, superseding that fast path. In other words: with
            # approval routing on, *every* Bash call needs a phone tap, not
            # just the risky ones — deliberately, since there's no reliable
            # way to tell "safe" and "risky" Bash commands apart from here.
            "--permission-mode", "acceptEdits",
            "--add-dir", str(project_path),
        ]
        if resume_session_id:
            # -r/--resume takes a session id in --print mode and continues
            # that conversation instead of starting a fresh one.
            argv += ["--resume", resume_session_id]
        if approval_endpoint:
            argv += ["--settings", _build_approval_settings(approval_endpoint)]
        return argv

    def parse_event(self, line: str) -> dict | list[dict] | None:
        line = line.strip()
        if not line:
            return None
        try:
            event = json.loads(line)
        except (ValueError, TypeError):
            return {"kind": "raw", "text": line}

        if not isinstance(event, dict):
            return {"kind": "raw", "text": line}

        # Every stream-json event (init, assistant turns, the final result)
        # carries the session_id for this run; stash the latest one seen so
        # session_id() can hand it back for a future --resume.
        if event.get("session_id"):
            self._session_id = event["session_id"]

        etype = event.get("type")

        if etype == "system" and event.get("subtype") == "init":
            tools = event.get("tools") or []
            return {
                "kind": "session_init",
                "model": event.get("model"),
                "tool_count": len(tools),
            }

        if etype in ("assistant", "user"):
            parsed = self._parse_message_blocks(event.get("message") or {})
            if parsed:
                return parsed
            return {"kind": "raw", "text": line}

        if etype == "result":
            return {
                "kind": "result_summary",
                "success": not event.get("is_error", False),
                "text": event.get("result"),
                "duration_ms": event.get("duration_ms"),
                "cost_usd": event.get("total_cost_usd"),
                "num_turns": event.get("num_turns"),
            }

        # Unrecognized top-level type (future CLI version, etc.) — surface it
        # verbatim rather than silently dropping it.
        return {"kind": "raw", "text": line}

    def _parse_message_blocks(self, message: dict) -> list[dict]:
        """Turn one assistant/user message's `content` blocks into normalized
        events. A single turn commonly mixes a text block with a tool_use
        block (or, for user turns, one or more tool_result blocks), so this
        always returns a list — main.py sends each entry in order."""
        content = message.get("content")
        if isinstance(content, str):
            # Some CLI versions send plain-string content instead of a
            # content-block array for simple text turns.
            return [{"kind": "assistant_text", "text": content}] if content.strip() else []

        if not isinstance(content, list):
            return []

        events: list[dict] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            block_type = block.get("type")

            if block_type == "text":
                text = str(block.get("text") or "").strip()
                if text:
                    events.append({"kind": "assistant_text", "text": text})

            elif block_type == "tool_use":
                name = str(block.get("name") or "tool")
                tool_input = block.get("input") or {}
                events.append({
                    "kind": "tool_use",
                    "tool": name,
                    "input": tool_input,
                    "text": _summarize_tool_input(name, tool_input),
                })

            elif block_type == "tool_result":
                events.append({
                    "kind": "tool_result",
                    "is_error": bool(block.get("is_error")),
                    "text": _extract_tool_result_text(block.get("content")),
                })

            # thinking/redacted_thinking blocks and anything else are
            # intentionally not surfaced — internal reasoning, not output.

        return events

    def session_id(self) -> str | None:
        return self._session_id


_MAX_TOOL_RESULT_CHARS = 500


def _summarize_tool_input(name: str, tool_input: dict) -> str:
    """Best-effort one-line human summary of a tool call's input, so the
    phone can show e.g. "Bash: git status" instead of a raw JSON blob. Falls
    back to compact JSON for tools/shapes this doesn't special-case."""
    if not isinstance(tool_input, dict):
        return str(tool_input)

    for key in ("command", "file_path", "pattern", "url", "path", "query"):
        value = tool_input.get(key)
        if isinstance(value, str) and value:
            return value

    if name == "TodoWrite" and isinstance(tool_input.get("todos"), list):
        return f"{len(tool_input['todos'])} todo item(s)"

    return json.dumps(tool_input)[:200]


def _extract_tool_result_text(content) -> str:
    """tool_result content is either a plain string or a list of content
    blocks (text/image/...); pull out just the readable text, truncated."""
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        parts = [
            str(block.get("text", ""))
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        ]
        text = "\n".join(p for p in parts if p)
    else:
        text = ""

    text = text.strip()
    if len(text) > _MAX_TOOL_RESULT_CHARS:
        text = text[:_MAX_TOOL_RESULT_CHARS] + "…"
    return text


def _build_approval_settings(approval_endpoint: dict) -> str:
    """A `--settings` JSON string (session-only, per-run — nothing is
    written to the project's own .claude/settings.json) configuring one
    PreToolUse hook on the Bash tool: claude_approval_hook.py, which blocks
    and relays the call to main.py's local approval bridge at
    `approval_endpoint["port"]` for this `approval_endpoint["task_id"]`.

    The hook's own `command` is executed via a shell, so its arguments are
    shell-quoted even though task_id/port are devagent-generated and never
    attacker-controlled in practice.
    """
    port = approval_endpoint["port"]
    task_id = approval_endpoint["task_id"]
    command = " ".join(
        shlex.quote(part)
        for part in (
            sys.executable,
            str(_APPROVAL_HOOK_SCRIPT),
            "--port", str(port),
            "--task-id", task_id,
        )
    )
    settings = {
        "hooks": {
            "PreToolUse": [
                {
                    "matcher": "Bash",
                    # Comfortably under Claude Code's own default hook
                    # timeout (600s) so this hook always gets to return an
                    # explicit deny-with-reason itself (see
                    # claude_approval_hook.py's _SOCKET_TIMEOUT_S) instead of
                    # being killed uncleanly by the CLI.
                    "hooks": [{"type": "command", "command": command, "timeout": 280}],
                }
            ]
        }
    }
    return json.dumps(settings)
