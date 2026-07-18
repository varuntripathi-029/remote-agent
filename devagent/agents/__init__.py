"""Registry mapping a task.start message's "agent" field to an adapter class.

Adding a new CLI agent = write a BaseAgent subclass in this package + add one
line here. main.py never branches on an agent's name beyond this lookup; an
unrecognized name is handled by main.py sending an error log, not by this
module.
"""

from __future__ import annotations

from .base import BaseAgent
from .claude import ClaudeCodeAgent
from .codex import CodexAgent
from .gemini import GeminiAgent

AGENTS: dict[str, type[BaseAgent]] = {
    "claude": ClaudeCodeAgent,
    "gemini": GeminiAgent,
    "codex": CodexAgent,
}

__all__ = ["AGENTS", "BaseAgent"]
