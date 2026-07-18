"""Stub adapter for the Codex CLI. Not implemented yet.

Wire this up once the Codex CLI's non-interactive flags and streaming
output format are settled, following the same shape as claude.py: resolve
the executable with shutil.which, build an argv list (never a shell
string), and normalize each stdout line to a log-event dict.
"""

from __future__ import annotations

from pathlib import Path

from .base import BaseAgent


class CodexAgent(BaseAgent):
    name = "codex"

    def build_command(self, prompt: str, project_path: Path) -> list[str]:
        # TODO: something like
        #   ["codex", "exec", prompt, "--cd", str(project_path), ...]
        # once the real non-interactive / streaming-output flags are known.
        raise NotImplementedError("CodexAgent is a stub: CLI flags not wired up yet")

    def parse_event(self, line: str) -> dict | None:
        # TODO: parse whatever structured (or plain-text) output the Codex
        # CLI emits per line, normalizing to the same event shape
        # ClaudeCodeAgent.parse_event produces (fall back to
        # {"kind": "raw", "text": line} for anything unrecognized).
        raise NotImplementedError("CodexAgent is a stub: output format not wired up yet")
