# DevAgent Remote — Backend

A dumb, untrusted, agent-agnostic relay. It forwards JSON messages between
phones and laptop "devagents" by `device_id`. It never calls an LLM and
never contains logic specific to any one CLI agent (Claude Code, Gemini
CLI, Codex, Aider, ...). See [`../docs/PROTOCOL.md`](../docs/PROTOCOL.md)
for the message protocol.

**`/ws/phone` requires GitHub OAuth + a JWT (see "Auth setup" below).
`/ws/agent` does not yet — see the TODO(pairing) warning further down
before you consider exposing this anywhere but a private LAN.**

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
cp .env.example .env   # then edit it — see "Auth setup" below
uvicorn main:app --host 0.0.0.0 --port 8000
```

Then check the health endpoint:

```bash
curl http://localhost:8000/
# {"status":"ok","agents_online":[],"phones_online":[]}
```

## Auth setup

You need a GitHub OAuth App (one-time, ~2 minutes) and a JWT signing key.

1. Go to **github.com → Settings → Developer settings → OAuth Apps → New
   OAuth App**.
2. **Homepage URL**: anything (e.g. `http://localhost:8000`) — not used for
   the flow itself.
3. **Authorization callback URL**: must be this backend's own address, not
   the phone's — e.g. `http://192.168.1.23:8000/auth/github/callback`
   (swap in your PC's actual LAN IP, the same one the phone's Backend Host
   setting uses). This has to match `OAUTH_REDIRECT_URI` below exactly,
   including the scheme and port.
4. Register the app, then copy its **Client ID** and generate a **Client
   secret**.
5. `cp .env.example .env` and fill in:
   - `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — from step 4.
   - `OAUTH_REDIRECT_URI` — the exact URL from step 3.
   - `JWT_SECRET` — generate your own, don't reuse the placeholder:
     ```bash
     python -c "import secrets; print(secrets.token_urlsafe(48))"
     ```
6. Restart the backend so it picks up `.env` (`uvicorn` doesn't hot-reload
   env vars).

`.env` is gitignored — never commit it. Only `.env.example` (placeholders
only) belongs in git.

**Do not deploy this backend somewhere internet-reachable yet.** `/ws/phone`
is authenticated now, but `/ws/agent` (a laptop connecting) still isn't —
see the TODO(pairing) note in `main.py`'s module docstring. On a private LAN
the exposure is limited to whoever's already on your network; on the public
internet, anyone could register as a fake devagent under any `device_id`
they choose. That closes in the next hardening phase (Ed25519 + pairing
code, aim.md §4).

## Endpoints

- `GET /` — health check; lists currently connected `agents_online` and
  `phones_online` device/phone ids.
- `GET /auth/github/login?return_to=<uri>` — start GitHub OAuth login. See
  `auth.py`; `return_to` must be an `exp://` (Expo Go) or `devagentremote://`
  (native build) URI — anything else is rejected.
- `GET /auth/github/callback` — GitHub redirects here after login; not
  meant to be opened directly.
- `WS /ws/agent` — a devagent (laptop) connects here and dials out to the
  backend. First frame must be `{"type": "register", "device_id": "..."}`.
  **Unauthenticated for now** — see "Auth setup" above.
- `WS /ws/phone` — a phone connects here. First frame must be
  `{"type": "register", "phone_id": "...", "token": "<jwt>"}` — a missing or
  invalid/expired `token` gets `{"type": "error", "reason": "unauthorized", ...}`
  and the connection is dropped. On success, backend replies with
  `{"type": "devices", "online": [...]}`.

## Design notes / what's stubbed for later

- **Storage**: `registry.py` holds connections in an in-memory dict per
  process; `auth.py`'s `UserStore` does the same for users. Fine for one
  backend instance; swap in Postgres/Redis if this ever needs to survive
  restarts or scale to multiple replicas — both are structured so that's a
  reimplementation of a couple of methods, not a rewrite of call sites.
- **Auth**: GitHub OAuth + JWT for `/ws/phone` (see `auth.py` and "Auth
  setup" above) — implements aim.md §4's "GitHub OAuth identifies the
  human, JWT authenticates every phone→backend request." `/ws/agent` and
  device-ownership enforcement (`auth.user_owns_device`, currently a
  TODO(pairing) stub that always allows) are the next phase: Ed25519 device
  keys + a pairing code.
- **Encryption**: message payloads are relayed as opaque JSON. A future
  end-to-end-encryption layer can carry ciphertext in the same fields without
  changing any shapes in `docs/PROTOCOL.md` or this backend's code.
- **Agent-agnostic**: the backend never inspects `agent`, `prompt`, `tool`,
  etc. It only reads `type` and routing fields (`device_id`). Any current or
  future CLI agent adapter works without backend changes. `auth.py` mirrors
  this: it identifies *who* is asking, never *what* they're asking for.

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
# terminal 3: pretend to be a phone — needs a real JWT now (register via
# GitHub OAuth from the phone app first, or mint one for testing):
#   python -c "import auth; u = auth.users.get_or_create(1, 'test'); print(auth.issue_jwt(u))"
python - <<'PY'
import asyncio, websockets, json

TOKEN = "paste a real JWT here"

async def main():
    async with websockets.connect("ws://localhost:8000/ws/phone") as ws:
        await ws.send(json.dumps({"type": "register", "phone_id": "phone-1", "token": TOKEN}))
        print(await ws.recv())  # {"type": "devices", "online": ["laptop-1"]}
        await ws.send(json.dumps({
            "type": "task.start", "task_id": "t1", "device_id": "laptop-1",
            "agent": "claude", "project": "demo", "prompt": "hello"
        }))

asyncio.run(main())
PY
```

Terminal 2 should print the `task.start` message it received.
