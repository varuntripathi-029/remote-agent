"""DevAgent Remote — backend relay.

This service is a DUMB, UNTRUSTED, AGENT-AGNOSTIC relay. It understands
nothing about any particular CLI agent and never calls an LLM. Its only
job is:

  1. Let devagents (laptops) and phones register under an id.
  2. Forward messages between them by device_id, verbatim, unparsed beyond
     the routing fields it needs (`type`, `device_id`).

See ../docs/PROTOCOL.md for the full message protocol this relays.

/ws/phone requires a valid JWT (see auth.py) on its register message —
GitHub OAuth identifies the human, the JWT authenticates every request after
that, per aim.md §4.

TODO(pairing): /ws/agent (a devagent/laptop connecting) is still
UNAUTHENTICATED. Binding a device_id to a user_id — so a stolen/fabricated
device_id can't be addressed by an unrelated account, and so this endpoint
itself can require identity — is the Ed25519 + pairing-code phase, not this
one. Per backend/README.md: DO NOT deploy this backend somewhere
internet-reachable until that phase closes this hole; on a private LAN the
practical exposure is low, but it is a real one.

TODO(persistence): registries are in-memory and reset on restart. Swap
registry.ConnectionRegistry for a Postgres/Redis-backed implementation if the
backend ever needs to survive restarts or run as multiple replicas.

TODO(crypto): payloads are relayed as opaque JSON today; nothing here reads
their contents. If end-to-end encryption is added later, ciphertext just
rides along in the same fields and this file does not need to change.
"""

from __future__ import annotations

import json
import logging

from dotenv import load_dotenv

# Must run before `import auth` — auth.py reads GITHUB_CLIENT_ID etc. from
# os.environ at *module import time*, so .env has to be loaded first.
load_dotenv()

from fastapi import FastAPI, WebSocket, WebSocketDisconnect  # noqa: E402

import auth  # noqa: E402
from registry import ConnectionRegistry  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("devagent-relay")

app = FastAPI(title="DevAgent Remote Backend")
app.include_router(auth.router)

# Two independent registries: one for laptop-side devagents, one for phones.
agents = ConnectionRegistry()
phones = ConnectionRegistry()

# phone_id -> user_id for every currently-registered phone connection, so
# the ownership check below (auth.user_owns_device) has a user_id to check
# against. Population/cleanup mirrors `phones` registry's own lifecycle —
# see _register_phone/finally block in ws_phone.
phone_user_ids: dict[str, str] = {}


@app.get("/")
async def health() -> dict:
    """Health check: which agents and phones are currently online."""
    return {
        "status": "ok",
        "agents_online": agents.all_ids(),
        "phones_online": phones.all_ids(),
    }


@app.websocket("/ws/agent")
async def ws_agent(websocket: WebSocket) -> None:
    # TODO(pairing): unauthenticated — see module docstring.
    await websocket.accept()
    device_id: str | None = None
    try:
        device_id = await _register(websocket, agents, id_field="device_id")
        if device_id is None:
            return

        logger.info("agent connected: device_id=%s", device_id)

        while True:
            message = await _recv_json(websocket)
            if message is None:
                continue

            msg_type = message.get("type")
            if msg_type == "register":
                # Already registered above; ignore repeats rather than erroring.
                continue

            # Everything else from an agent is routed up to phones, unparsed.
            # TODO(routing): once phone<->device subscriptions exist, only
            # deliver to phones actively watching this device_id instead of
            # broadcasting to all connected phones.
            await _broadcast(phones.all_sockets(), message)

    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("unexpected error on agent socket (device_id=%s)", device_id)
    finally:
        if device_id is not None:
            agents.unregister(device_id)
            logger.info("agent disconnected: device_id=%s", device_id)


@app.websocket("/ws/phone")
async def ws_phone(websocket: WebSocket) -> None:
    await websocket.accept()
    phone_id: str | None = None
    try:
        registered = await _register_phone(websocket)
        if registered is None:
            return
        phone_id, user_id = registered

        logger.info("phone connected: phone_id=%s user_id=%s", phone_id, user_id)
        await websocket.send_json({"type": "devices", "online": agents.all_ids()})

        while True:
            message = await _recv_json(websocket)
            if message is None:
                continue

            msg_type = message.get("type")
            if msg_type == "register":
                continue

            target_device_id = message.get("device_id")
            if not target_device_id:
                await websocket.send_json(
                    {"type": "error", "reason": "bad_message", "detail": "missing device_id"}
                )
                continue

            # TODO(pairing): the only ownership check that exists today —
            # see auth.user_owns_device's own docstring for why it's a
            # placeholder (always True) until devices are bound to users.
            if not auth.user_owns_device(user_id, target_device_id):
                await websocket.send_json(
                    {"type": "error", "reason": "forbidden", "device_id": target_device_id}
                )
                continue

            agent_socket = agents.get(target_device_id)
            if agent_socket is None:
                await websocket.send_json(
                    {"type": "error", "reason": "device_offline", "device_id": target_device_id}
                )
                continue

            # Routed down to the target agent, unparsed beyond device_id above.
            try:
                await agent_socket.send_json(message)
            except Exception:
                logger.exception("failed to deliver message to device_id=%s", target_device_id)
                await websocket.send_json(
                    {"type": "error", "reason": "device_offline", "device_id": target_device_id}
                )

    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("unexpected error on phone socket (phone_id=%s)", phone_id)
    finally:
        if phone_id is not None:
            phones.unregister(phone_id)
            phone_user_ids.pop(phone_id, None)
            logger.info("phone disconnected: phone_id=%s", phone_id)


async def _register(
    websocket: WebSocket, registry: ConnectionRegistry, id_field: str
) -> str | None:
    """Wait for the required first {"type": "register", ...} message.

    Returns the registered id, or None if the socket disconnected or sent
    something unusable before ever registering (the caller should just return
    in that case; there is nothing left to clean up).
    """
    message = await _recv_json(websocket)
    if message is None:
        return None

    if message.get("type") != "register" or not message.get(id_field):
        logger.warning("first message was not a valid register: %r", message)
        await websocket.send_json(
            {
                "type": "error",
                "reason": "bad_message",
                "detail": f"expected register message with '{id_field}'",
            }
        )
        return None

    conn_id = message[id_field]
    registry.register(conn_id, websocket)
    return conn_id


async def _register_phone(websocket: WebSocket) -> tuple[str, str] | None:
    """Phone-specific counterpart to _register(): same
    {"type": "register", ...} handshake, but a phone's register message must
    also carry a `token` (the JWT auth.py issued at GitHub OAuth login) —
    see docs/PROTOCOL.md's Registration handshake section. /ws/agent has no
    equivalent yet (TODO(pairing), see module docstring), so that side still
    uses the plain _register() above.

    Returns (phone_id, user_id), or None if the socket disconnected or
    failed to register/authenticate (the caller should just return; there is
    nothing left to clean up either way).
    """
    message = await _recv_json(websocket)
    if message is None:
        return None

    if message.get("type") != "register" or not message.get("phone_id"):
        logger.warning("first message was not a valid register: %r", message)
        await websocket.send_json(
            {"type": "error", "reason": "bad_message", "detail": "expected register message with 'phone_id'"}
        )
        return None

    token = message.get("token")
    user_id = auth.decode_jwt(token) if token else None
    if user_id is None:
        logger.warning("phone register with missing/invalid token: phone_id=%r", message.get("phone_id"))
        await websocket.send_json(
            {"type": "error", "reason": "unauthorized", "detail": "missing or invalid token"}
        )
        return None

    phone_id = message["phone_id"]
    phones.register(phone_id, websocket)
    phone_user_ids[phone_id] = user_id
    return phone_id, user_id


async def _recv_json(websocket: WebSocket) -> dict | None:
    """Receive one frame and parse it as a JSON object.

    Never raises on malformed input (bad JSON, non-object payloads) — logs a
    warning and returns None so callers can just skip the message and keep
    the connection alive. WebSocketDisconnect propagates to the caller.
    """
    try:
        data = await websocket.receive_text()
    except WebSocketDisconnect:
        raise

    try:
        message = json.loads(data)
    except (ValueError, TypeError):
        logger.warning("dropping non-JSON message: %r", data[:200])
        return None

    if not isinstance(message, dict):
        logger.warning("dropping non-object JSON message: %r", message)
        return None

    return message


async def _broadcast(sockets: list[WebSocket], message: dict) -> None:
    for socket in sockets:
        try:
            await socket.send_json(message)
        except Exception:
            logger.exception("failed to broadcast message to a phone socket")
