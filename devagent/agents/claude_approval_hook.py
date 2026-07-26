"""PreToolUse hook Claude Code runs for every Bash tool call, when a task was
started with approval routing available (see claude.py's build_command,
which wires this in via --settings). Blocks synchronously, relaying the
pending call to devagent's local approval bridge (main.py's
_handle_approver_conn) over a loopback TCP connection, which forwards it to
the phone as an approval.request and waits for the matching
approval.response (see docs/PROTOCOL.md).

Speaks Claude Code's PreToolUse hook JSON contract on stdin/stdout — see
https://code.claude.com/docs/en/hooks. Everything else here is a plain,
dependency-free TCP client (stdlib only) so it runs under any Python 3
interpreter without activating a venv.
"""

from __future__ import annotations

import argparse
import json
import socket
import sys

# Below Claude Code's own hook timeout (set alongside this script in
# claude.py's _build_approval_settings) so this always gets to print an
# explicit, readable deny reason instead of being killed uncleanly.
_SOCKET_TIMEOUT_S = 270


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--task-id", required=True)
    args = parser.parse_args()

    try:
        hook_input = json.load(sys.stdin)
    except (ValueError, TypeError):
        hook_input = {}

    tool_name = hook_input.get("tool_name", "tool")
    tool_input = hook_input.get("tool_input", {})

    allow, reason = _ask_devagent(args.port, args.task_id, tool_name, tool_input)

    hook_output = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow" if allow else "deny",
        }
    }
    if reason:
        hook_output["hookSpecificOutput"]["permissionDecisionReason"] = reason
    print(json.dumps(hook_output))
    return 0


def _ask_devagent(
    port: int, task_id: str, tool_name: str, tool_input: dict
) -> tuple[bool, str | None]:
    request = json.dumps({"task_id": task_id, "tool_name": tool_name, "tool_input": tool_input})
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=10) as sock:
            sock.settimeout(_SOCKET_TIMEOUT_S)
            sock.sendall((request + "\n").encode())
            buf = b""
            while not buf.endswith(b"\n"):
                chunk = sock.recv(4096)
                if not chunk:
                    break
                buf += chunk
        response = json.loads(buf.decode())
        return bool(response.get("allow")), response.get("reason")
    except Exception as exc:  # noqa: BLE001 — any failure here must still deny cleanly
        return False, f"could not reach devagent's approval bridge: {exc}"


if __name__ == "__main__":
    sys.exit(main())
