"""Adapter for the Claude Code CLI.

Example value of task.start's "agent" field that routes here: "claude". This
is the only file in the devagent allowed to know Claude Code's flags and
output format — main.py, git_safety.py, and docs/PROTOCOL.md stay completely
unaware of it.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from .base import BaseAgent


class ClaudeCodeAgent(BaseAgent):
    name = "claude"

    def build_command(self, prompt: str, project_path: Path) -> list[str]:
        # shutil.which resolves the real target of PATH shims (claude.cmd on
        # Windows) so create_subprocess_exec can run it directly with
        # shell=False.
        executable = shutil.which("claude")
        if executable is None:
            raise FileNotFoundError("'claude' CLI not found on PATH")

        return [
            executable,
            "-p", prompt,
            "--output-format", "stream-json",
            "--verbose",
            # TODO(approval): M0 auto-approves every tool call via
            # acceptEdits. To route approvals to the phone instead, swap this
            # for:
            #   "--permission-mode", "plan",  # or drop this line
            #   "--permission-prompt-tool", "mcp__approver__ask",
            # ...and run a small local MCP server ("approver") that exposes an
            # `ask` tool. main.py's task runner would implement it by sending
            # {"type": "approval.request", "task_id", "req_id", "tool", "input"}
            # up to the phone (see docs/PROTOCOL.md), awaiting the matching
            # {"type": "approval.response", "req_id", "allow"}, and returning
            # allow/deny to Claude Code over the MCP stdio transport. No
            # change to this adapter's parse_event or to the protocol is
            # needed when that lands.
            "--permission-mode", "acceptEdits",
            "--add-dir", str(project_path),
        ]

    def parse_event(self, line: str) -> dict | None:
        line = line.strip()
        if not line:
            return None
        try:
            return json.loads(line)
        except (ValueError, TypeError):
            return {"kind": "raw", "text": line}
