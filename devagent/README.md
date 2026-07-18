# DevAgent Remote — devagent (laptop worker)

Runs on a laptop, dials **out** to the `backend/` relay (see
[`../docs/PROTOCOL.md`](../docs/PROTOCOL.md)), registers a `device_id`, and
drives a CLI coding agent — Claude Code first, but the core never mentions
"claude" — to do real work in a local, git-tracked project. Every task is
wrapped in a git checkpoint so it can always be reverted.

## Layout

```
devagent/
  main.py               core loop: connects, registers, routes projects.list/
                         task.start/task.revert, streams process output as logs
  agents/
    base.py              BaseAgent interface (build_command, parse_event)
    claude.py            ClaudeCodeAgent — the only file that knows Claude
                          Code's CLI flags/output format
    gemini.py, codex.py   stubs (raise NotImplementedError) — add real CLI
                          agents here later; see AGENTS in agents/__init__.py
  git_safety.py          checkpoint / summarize / revert / live git metadata
  config.py               loads projects.json (project registry, backend
                          URL, device_id)
  manage_projects.py       CLI to register/list/remove projects (see below)
  projects.example.json   template — copy to projects.json and edit
  mock_phone.py           CLI stand-in for the phone app, for testing
```

## Setup

```bash
cd devagent
python -m venv venv

# Windows (Git Bash):
source venv/Scripts/activate
# Windows (PowerShell): venv\Scripts\Activate.ps1
# macOS / Linux: source venv/bin/activate

pip install -r requirements.txt

cp projects.example.json projects.json
# then edit projects.json's device_id (any string identifying this laptop)
# and backend_url (ws://localhost:8000/ws/agent for local testing).
```

Also make sure whichever CLI agent you're using is on `PATH` (for M0:
`claude` — the [Claude Code CLI](https://docs.claude.com/claude-code)).

### Registering a project

Per `aim.md` §5, projects are added **manually and explicitly** — the
devagent never scans the filesystem for them, and the registry is the
security allowlist a `task.start`/`task.revert` is checked against. Use
`manage_projects.py`, which validates the path is a real git repo, resolves
its true repo root, and assigns a stable `project_id` (UUID) — the only
thing the backend and phone ever see; `local_path` never leaves this file.

```bash
python manage_projects.py add "my-repo" /path/to/my-repo
python manage_projects.py list
python manage_projects.py remove <project_id>
```

## Run it

With `backend/` already running (see `../backend/README.md`):

```bash
python main.py
```

You should see a log line confirming registration:
```
INFO registered with backend as device_id=laptop-1
```

## Test it without the phone app

In another terminal (same venv), run the mock phone client:

```bash
python mock_phone.py
```

It will prompt for `device_id`, list that device's registered projects (via
`projects.list`/`projects`), let you pick one by index, then prompt for an
`agent` and a `prompt`. It prints streamed logs and the final `task.result`,
and offers to send a `task.revert` back to the checkpoint the task started
from.

## End-to-end verification

1. Create a throwaway git repo and register it:
   `python manage_projects.py add demo /path/to/throwaway-repo`.
2. Start `backend/` (`uvicorn main:app --host 0.0.0.0 --port 8000`).
3. Start the devagent (`python main.py`) — confirm it registers.
4. Run `python mock_phone.py`, target `device_id=laptop-1`, pick the `demo`
   project, `agent=claude`, and a prompt like
   `create hello.txt with the text hi`.
5. Watch the streamed `log` messages (a `checkpoint` event first, then the
   Claude Code CLI's stream-json events, forwarded verbatim), then the final
   `task.result` with the checkpoint SHA, changed files, and diff stat.
6. Answer `y` at the revert prompt and confirm the repo is back to exactly
   the checkpoint commit (new files removed, edits undone).

## Design notes

- **Agent-agnostic core**: `main.py` only ever calls `agent.build_command()`
  and `agent.parse_event()` through the `BaseAgent` interface. It looks up
  the concrete class once, in `AGENTS[message["agent"]]`
  (`agents/__init__.py`), and never branches on an agent's name again.
  Adding Gemini/Codex/Aider support is one new `agents/*.py` subclass + one
  registry line — nothing here changes.
- **Never `shell=True`**: every adapter returns an argv list; `main.py` runs
  it with `asyncio.create_subprocess_exec(*argv, ...)`. A remote prompt can
  never break out into a shell command. `shutil.which` resolves the real
  target of PATH shims (e.g. `claude.cmd` on Windows) so the exec works
  cross-platform.
- **`project_id`, never a path, leaves this laptop**: per `aim.md` §5, the
  backend and phone only ever see `project_id` (UUID) + `display_name` +
  live git metadata (`current_branch`, `last_commit_hash`, `remote_url`) —
  never `local_path`. `config.py` resolves `project_id → local_path`
  entirely locally; a `task.start`/`task.revert` naming an unregistered
  `project_id` is rejected with an error log.
- **One task per project at a time**: an `asyncio.Lock` per `project_id`
  rejects a new `task.start` with an error log if one is already running for
  that project, rather than queuing or running concurrently.
- **Reconnect with backoff**: if the backend connection drops, `main.py`
  reconnects with exponential backoff (1s → 30s cap) and re-registers.
- **Approval seam (not built yet)**: M0 runs Claude Code with
  `--permission-mode acceptEdits`, auto-approving every tool call. See the
  `TODO(approval)` comment in `agents/claude.py` for exactly how this swaps
  to `--permission-prompt-tool mcp__approver__ask` plus a small local MCP
  server, turning each tool call into an `approval.request`/
  `approval.response` round trip to the phone per `docs/PROTOCOL.md` —
  without changing the adapter interface or the protocol.
