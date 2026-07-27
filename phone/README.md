# DevAgent Remote — phone app

Expo (managed workflow) + TypeScript app — the control surface the user
carries. Connects to the `backend/` relay's `/ws/phone` endpoint and speaks
[`../docs/PROTOCOL.md`](../docs/PROTOCOL.md) exactly. It never edits code
directly and never sends a filesystem path — only `project_id` (per
`../aim.md` §5).

## Layout

```
phone/
  app/                        expo-router screens (file-based routing)
    _layout.tsx                  root Stack, hydrates store, connects socket,
                                  redirects to login on logout/token expiry
    index.tsx                    GitHub OAuth login (see "Auth" below)
    devices.tsx                  online devices list
    device/[deviceId].tsx        agent + project pick, prompt, start task
    task/[taskId].tsx             live log stream, approval UI, result + revert
    settings.tsx                  backend host config + Log out
    help.tsx                     in-app setup guide + FAQ
  src/
    auth/github.ts              GitHub OAuth flow (expo-auth-session/expo-web-browser)
    types/protocol.ts           typed mirror of docs/PROTOCOL.md
    ws/client.ts                 WebSocket client (register + reconnect w/ backoff)
    store/useAppStore.ts        zustand store — devices/projects/task/auth state
    components/ErrorBanner.tsx  renders backend {"type":"error",...} messages
    util/formatLog.ts            renders a `log` message's opaque `data` field
    util/id.ts                    phone_id/task_id generation
    notifications.ts             expo-notifications STUB (see TODO(push) below)
    theme.ts                     shared colors
  .env.example                  copy to .env — sets the default backend host
```

## Setup

```bash
cd phone
npm install

cp .env.example .env
# edit .env: EXPO_PUBLIC_BACKEND_HOST=<your PC's LAN IP>:8000
```

**Important — this is the part that trips people up:** Expo Go runs *on your
phone*, not your PC. `localhost` in `.env` would mean the phone itself, which
has nothing listening on port 8000. You need:

1. `backend/` started with `uvicorn main:app --host 0.0.0.0 --port 8000` (not
   `--host localhost`) so it accepts connections from other devices on the
   network.
2. Your PC's actual LAN IP (Windows: `ipconfig`, look for the Wi-Fi adapter's
   IPv4 address — e.g. `192.168.1.23`).
3. The phone on the **same Wi-Fi network** as the PC.
4. `EXPO_PUBLIC_BACKEND_HOST=192.168.1.23:8000` in `.env` (or set it later
   from the app's **Settings** screen — that overrides `.env` at runtime and
   is persisted on the phone, so you don't have to rebuild to change it).

**No GitHub OAuth config belongs here.** This app never holds a GitHub
client secret — anything in an `EXPO_PUBLIC_*` var or `app.json` ships
inside the app bundle and is effectively public (extractable from the APK),
which is exactly why the OAuth App's Client ID/Secret live in
`backend/.env` instead, never here. See `backend/README.md`'s "Auth setup."

## Run it

```bash
npx expo start
```

Scan the QR code with the **Expo Go** app (Android) — phone and PC must be
on the same Wi-Fi. Expo Go will load the JS bundle from your PC over LAN.

If the QR/LAN connection doesn't work (e.g. router client isolation), run
`npx expo start --tunnel` instead (slower, but works across most networks).

## Walkthrough

1. **Login** (`index.tsx`) — tap **Sign in with GitHub**, complete the OAuth
   flow in the in-app browser, land back here with a JWT stored (see "Auth"
   below). Already logged in from a previous launch → skips straight past
   this screen.
2. **Devices** (`devices.tsx`) — shows every `device_id` the backend reports
   online (from its one-time `devices` reply at registration). Tap one.
3. **New Task** (`device/[deviceId].tsx`) — on mount, sends
   `{"type":"projects.list","device_id":...}` and renders the devagent's
   reply as a list of projects (`display_name` + live `current_branch` /
   `last_commit_hash` — never a path). Pick an **agent** chip (`claude` /
   `gemini` / `codex` — a plain list per `aim.md`, no agent-specific code
   here), pick a **project**, type a **prompt**, tap **Start Task**.
4. **Task** (`task/[taskId].tsx`) — streams `log` messages into a
   terminal-style view live; if an `approval.request` arrives, an
   Approve/Deny bar appears (works today for the `claude` agent's Bash
   calls — see the Approval seam note below for the other two); when
   `task.result` arrives, shows the changed-file list + insertions/deletions
   and a **Revert** button that sends `task.revert` with the checkpoint
   from that result.
5. **Settings** (reachable from Login or the Devices header) — edit the
   backend host at runtime (reconnects immediately on save), or **Log out**
   (clears the stored JWT, forces a fresh GitHub login).

## Verified

- `npx tsc --noEmit` — clean, no type errors.
- `npx expo-doctor` — 20/20 checks pass.
- `npx expo export --platform android` — the whole app (1304 modules)
  bundles with no errors, confirming every screen/import resolves.
- `npx expo start` — Metro dev server boots cleanly, serves the app (HTML
  response confirms the `DevAgent Remote` title from `app.json`), and is
  reachable at the PC's LAN IP on port 8081 alongside the backend on 8000.
- The backend + devagent (`device_id=laptop-1`, project `demo`) were live
  and confirmed working end-to-end via `devagent/mock_phone.py` in the same
  session — the phone app speaks the identical protocol messages, so a task
  started from the app hits the same verified path (checkpoint → Claude Code
  run → `task.result` → revert) as the mock client did.
- **Not verified here**: actually scanning the QR code with a physical
  Expo Go client — this environment has no phone/emulator attached. The
  screen-by-screen walkthrough above describes exactly what the app does at
  each step; connecting a real device and confirming it matches is the one
  remaining step, and it's on you (I have no way to drive a physical Android
  phone from here).

## Design notes

- **`project_id`, never a path**: the device/[deviceId] screen only ever
  stores/sends the `project_id` strings the devagent handed back in its
  `projects` reply. There is no path field anywhere in `src/types/protocol.ts`
  or the store.
- **Agent-agnostic UI**: `AGENT_OPTIONS` in `src/types/protocol.ts` is a
  plain string list (`claude`/`gemini`/`codex`); nothing in `app/` or `src/`
  branches on which one is selected. `src/util/formatLog.ts` only
  special-cases the small set of `kind` values the devagent *core* emits
  (`checkpoint`/`error`/`stderr`/`raw`/`revert` — shared across every
  adapter); any other `log` payload (an agent's own structured output) is
  rendered with a generic fallback, so this file never has to know what
  "claude" is.
- **Reconnect with backoff**: `src/ws/client.ts` mirrors the devagent's own
  reconnect loop (1s → 15s cap) so both ends degrade the same way if the
  backend restarts.
- **M0's `devices` list is a one-time snapshot** (per `docs/PROTOCOL.md`):
  the backend only sends it at registration, so `devices.tsx` has a
  **Refresh** button that reconnects (triggering a fresh register + reply)
  rather than expecting live push updates.
- **Revert status isn't a distinct protocol message**: a revert's outcome
  arrives as a devagent-level `log` event with `kind: "revert"` or
  `kind: "error"` (see `devagent/main.py`), not a dedicated ack — the store
  watches for that specific log shape only while a revert is pending for
  that task, so an unrelated log line can't be misread as a revert result.

### Auth — `src/auth/github.ts`, `app/index.tsx`, `src/store/useAppStore.ts`

Per `aim.md` §4: GitHub OAuth identifies the human, a JWT (issued by
`backend/auth.py`) authenticates every `/ws/phone` request after that.
`phone_id` (`src/util/id.ts`) is unrelated — still just a WebSocket routing
handle, never an identity.

- **The GitHub client secret never reaches this app.** `loginWithGithub()`
  opens the backend's `/auth/github/login` in an in-app browser
  (`expo-web-browser`'s `openAuthSessionAsync`); the backend does the whole
  GitHub code exchange server-side and redirects back with only our own JWT.
  Works in **Expo Go**, no native build: `expo-auth-session`'s
  `makeRedirectUri()` produces an `exp://<metro-host>:8081/--/redirect` URI
  there (a `devagentremote://` deep link — see `app.json`'s `scheme` — in a
  native build instead), and that's what gets passed as `return_to`.
- **The JWT lives in `expo-secure-store`, never AsyncStorage** (Keychain/
  Keystore-backed — see `useAppStore.ts`'s `JWT_KEY`) and persists across
  restarts, separately from the zustand `persist()` middleware that backs
  chat history via AsyncStorage.
- **On an `unauthorized` error** (expired/invalid token, or the backend
  restarted with a different `JWT_SECRET`) the store clears the token and
  `_layout.tsx` (watching it) routes back to login automatically, from
  whatever screen the user was on.
- **Ed25519 device keys + a pairing code** for linking a new laptop are the
  next hardening phase (aim.md §4) — not built here.

### TODO(push) — `src/notifications.ts`

`expo-notifications` is installed and permission is requested, but nothing
registers a push token or sends one to the backend. Wiring a
`task.result`/`approval.request` to notify a backgrounded phone is a later
phase; Expo Go's own remote-push support is also limited on recent SDKs
(local notifications still work), so this stub deliberately stays
local-only for now.

### Approval seam

`task/[taskId].tsx` renders the Approve/Deny bar and sends
`{"type":"approval.response","req_id","allow"}` unconditionally whenever an
`approval.request` arrives. The devagent side (a `PreToolUse` hook on `Bash`
calls, relayed through a local approval bridge — see `devagent/README.md`'s
"Approval bridge" section) now actually triggers this for shell commands
that need a decision (`git push`, `npm run dev`, ...); routine file edits
still auto-approve via `acceptEdits` and never reach this bar.
