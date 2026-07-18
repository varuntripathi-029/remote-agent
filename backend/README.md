# DevAgent Remote — Backend

A dumb, untrusted, agent-agnostic relay. It authenticates connections
(TODO) and forwards JSON messages between phones and laptop "devagents" by
`device_id`. It never calls an LLM and never contains logic specific to any
one CLI agent (Claude Code, Gemini CLI, Codex, Aider, ...). See
[`../docs/PROTOCOL.md`](../docs/PROTOCOL.md) for the message protocol.

## Run it

```bash
cd backend
python -m venv venv

# Windows (Git Bash / PowerShell):
source venv/Scripts/activate      # Git Bash
# venv\Scripts\Activate.ps1       # PowerShell

# macOS / Linux:
# source venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Then check the health endpoint:

```bash
curl http://localhost:8000/
# {"status":"ok","agents_online":[],"phones_online":[]}
```

## Endpoints

- `GET /` — health check; lists currently connected `agents_online` and
  `phones_online` device/phone ids.
- `WS /ws/agent` — a devagent (laptop) connects here and dials out to the
  backend. First frame must be `{"type": "register", "device_id": "..."}`.
- `WS /ws/phone` — a phone connects here. First frame must be
  `{"type": "register", "phone_id": "..."}`. Backend replies with
  `{"type": "devices", "online": [...]}`.

## Design notes / what's stubbed for later

- **Storage**: `registry.py` holds connections in an in-memory dict per
  process. Fine for one backend instance; swap in Postgres/Redis if this
  ever needs to survive restarts or scale to multiple replicas.
- **Auth**: there is none yet. Any `register` message is accepted. A token/JWT
  check slots into `_register()` in `main.py`.
- **Encryption**: message payloads are relayed as opaque JSON. A future
  end-to-end-encryption layer can carry ciphertext in the same fields without
  changing any shapes in `docs/PROTOCOL.md` or this backend's code.
- **Agent-agnostic**: the backend never inspects `agent`, `prompt`, `tool`,
  etc. It only reads `type` and routing fields (`device_id`). Any current or
  future CLI agent adapter works without backend changes.

## Quick manual test

With the server running, in two more terminals:

```bash
# terminal 2: pretend to be a devagent
python - <<'PY'
import asyncio, websockets, json

async def main():
    async with websockets.connect("ws://localhost:8000/ws/agent") as ws:
        await ws.send(json.dumps({"type": "register", "device_id": "laptop-1"}))
        print(await ws.recv())  # will hang here waiting for messages; Ctrl+C to stop
        async for msg in ws:
            print("agent got:", msg)

asyncio.run(main())
PY
```

```bash
# terminal 3: pretend to be a phone
python - <<'PY'
import asyncio, websockets, json

async def main():
    async with websockets.connect("ws://localhost:8000/ws/phone") as ws:
        await ws.send(json.dumps({"type": "register", "phone_id": "phone-1"}))
        print(await ws.recv())  # {"type": "devices", "online": ["laptop-1"]}
        await ws.send(json.dumps({
            "type": "task.start", "task_id": "t1", "device_id": "laptop-1",
            "agent": "claude", "project": "demo", "prompt": "hello"
        }))

asyncio.run(main())
PY
```

Terminal 2 should print the `task.start` message it received.
