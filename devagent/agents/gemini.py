import json
import os
import re
import shutil
import tempfile
from pathlib import Path

from .base import BaseAgent

# Matches the one line agy.exe's debug log always emits once it has settled
# on a conversation id for this run, whether that conversation was just
# created or resumed via --conversation:
#   "... conversation_manager.go:587] Streaming conversation <uuid>"
_STREAMING_CONVERSATION_RE = re.compile(
    r"Streaming conversation ([0-9a-fA-F-]{36})"
)


class GeminiAgent(BaseAgent):
    name = "gemini"

    def __init__(self) -> None:
        self._log_path: Path | None = None

    def build_command(
        self,
        prompt: str,
        project_path: Path,
        resume_session_id: str | None = None,
        approval_endpoint: dict | None = None,
    ) -> list[str]:
        executable = (
            shutil.which("gemini")
            or shutil.which("gemini.cmd")
            or shutil.which("agy")
            or shutil.which("agy.cmd")
            or shutil.which("agy.exe")
            or shutil.which(r"C:\Users\Asus\.gemini\antigravity-ide\bin\agentapi.bat")
            or shutil.which("agentapi.bat")
        )

        if executable is None:
            raise FileNotFoundError("'gemini' or 'agy' CLI not found on PATH")

        # If calling agentapi.bat, ensure ANTIGRAVITY_LS_ADDRESS is available
        if "agentapi" in executable and "ANTIGRAVITY_LS_ADDRESS" not in os.environ:
            os.environ["ANTIGRAVITY_LS_ADDRESS"] = "localhost:63838"

        # Neither `gemini`/`agy`'s --print mode nor its stdout carry the
        # conversation id anywhere; the only place it's ever written is this
        # debug log, one line per run, cleaned up in session_id() below.
        fd, log_path = tempfile.mkstemp(prefix="devagent-gemini-", suffix=".log")
        os.close(fd)
        self._log_path = Path(log_path)

        argv = [
            executable,
            "-p", prompt,
            "--log-file", str(self._log_path),
            # Without this, agy/Antigravity has no active workspace in
            # headless mode and silently falls back to its own default
            # scratch dir (~/.gemini/antigravity-cli/scratch) instead of
            # project_path — confirmed via `agy -p "print your workspace
            # path"` with and without --add-dir. Unlike Claude Code, where
            # --add-dir only *adds to* an implicit cwd-based workspace, this
            # is load-bearing here: it's what sets the workspace at all.
            "--add-dir", str(project_path),
            "--mode", "accept-edits",
        ]
        if resume_session_id:
            # Unrecognized ids are silently ignored (a new conversation is
            # started instead) rather than erroring, so this is best-effort.
            argv += ["--conversation", resume_session_id]
        return argv

    def parse_event(self, line: str) -> dict | None:
        line = line.strip()
        if not line:
            return None
        try:
            return json.loads(line)
        except (ValueError, TypeError):
            return {"kind": "raw", "text": line}

    def session_id(self) -> str | None:
        if self._log_path is None:
            return None
        try:
            text = self._log_path.read_text(errors="replace")
        except OSError:
            return None
        finally:
            self._log_path.unlink(missing_ok=True)

        match = _STREAMING_CONVERSATION_RE.search(text)
        return match.group(1) if match else None

