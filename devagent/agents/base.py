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
        self, prompt: str, project_path: Path, resume_session_id: str | None = None
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
        """

    @abstractmethod
    def parse_event(self, line: str) -> dict | None:
        """Normalize one line of the process's stdout into a log-event dict.

        Return None to swallow a line entirely (e.g. blank keep-alive
        output). Must never raise: a line this adapter can't make sense of
        should become a fallback event (e.g. {"kind": "raw", "text": line}),
        not an exception that kills the streaming loop.
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
