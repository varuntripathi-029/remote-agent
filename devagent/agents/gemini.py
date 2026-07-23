import json
import shutil
from pathlib import Path

from .base import BaseAgent


class GeminiAgent(BaseAgent):
    name = "gemini"

    def build_command(self, prompt: str, project_path: Path) -> list[str]:
        executable = (
            shutil.which("gemini")
            or shutil.which("gemini.cmd")
            or shutil.which("agy")
            or shutil.which("agy.cmd")
            or shutil.which("agy.exe")
        )
        if executable is None:
            raise FileNotFoundError("'gemini' or 'agy' CLI not found on PATH")

        return [
            executable,
            "-p", prompt,
        ]

    def parse_event(self, line: str) -> dict | None:
        line = line.strip()
        if not line:
            return None
        try:
            return json.loads(line)
        except (ValueError, TypeError):
            return {"kind": "raw", "text": line}

