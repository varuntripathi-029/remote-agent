# DevAgent Remote

Control CLI-based AI coding agents (Claude Code, Gemini CLI, Codex, Aider, ...)
running on your home laptop, remotely, from your phone.

## The three parts

```
phone  <--WebSocket-->  backend  <--WebSocket-->  devagent
(app)                   (relay)                   (laptop)
```

- **[`backend/`](backend/)** — a small FastAPI relay. Dumb, untrusted, and
  agent-agnostic: it never calls an LLM and never contains logic specific to
  any one CLI agent. It only authenticates connections (TODO) and forwards
  JSON messages between phones and laptops by `device_id`. **Implemented.**
- **[`devagent/`](devagent/)** — the process that runs on a laptop, dials out
  to the backend (reverse tunnel, no home ports opened), and drives whichever
  CLI agent is selected via an adapter pattern. Also owns git
  checkpoint/revert around each task. *Placeholder — not built yet.*
- **[`phone/`](phone/)** — an Expo/React Native app for starting tasks,
  watching live output, approving tool calls, and reverting checkpoints, for
  any connected laptop/agent. *Placeholder — not built yet.*

## How they connect

Each laptop dials **out** to the backend and holds a WebSocket open, so
nothing needs to be exposed on the home network. Phones connect in
separately. The backend just routes messages between the two sides by
`device_id` — it never inspects or acts on the payloads it forwards.

The full JSON message protocol shared by all three parts lives in
[`docs/PROTOCOL.md`](docs/PROTOCOL.md) — that's the source of truth; keep it
updated if the protocol changes.

## Status

- `backend/` — implemented (FastAPI, in-memory registry, WebSocket relay).
- `devagent/` — not started.
- `phone/` — not started.

See `backend/README.md` for how to run the relay locally.
