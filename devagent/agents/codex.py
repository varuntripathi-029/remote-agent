import json
import shutil
from pathlib import Path

from .base import BaseAgent


class CodexAgent(BaseAgent):
    name = "codex"

    def build_command(self, prompt: str, project_path: Path) -> list[str]:
        executable = (
            shutil.which("codex")
            or shutil.which("codex.cmd")
            or shutil.which("codex.exe")
        )
        if executable is None:
            raise FileNotFoundError("'codex' CLI not found on PATH")

        return [
            executable,
            "exec", prompt,
        ]

    def parse_event(self, line: str) -> dict | None:
        line = line.strip()
        if not line:
            return None
        try:
            return json.loads(line)
        except (ValueError, TypeError):
            return {"kind": "raw", "text": line}

