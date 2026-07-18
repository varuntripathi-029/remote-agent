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
    def build_command(self, prompt: str, project_path: Path) -> list[str]:
        """Return the argv to exec for one task run.

        Always a list of args, never a shell string — main.py runs this via
        asyncio.create_subprocess_exec(*argv), so the prompt (arbitrary,
        remote-supplied text) can never break out into a shell command.
        """

    @abstractmethod
    def parse_event(self, line: str) -> dict | None:
        """Normalize one line of the process's stdout into a log-event dict.

        Return None to swallow a line entirely (e.g. blank keep-alive
        output). Must never raise: a line this adapter can't make sense of
        should become a fallback event (e.g. {"kind": "raw", "text": line}),
        not an exception that kills the streaming loop.
        """
