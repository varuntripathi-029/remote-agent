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

        # Every stream-json event (init, assistant turns, the final result)
        # carries the session_id for this run; stash the latest one seen so
        # session_id() can hand it back for a future --resume.
        if isinstance(event, dict) and event.get("session_id"):
            self._session_id = event["session_id"]
        return event

    def session_id(self) -> str | None:
        return self._session_id
