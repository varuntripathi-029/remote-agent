"""DevAgent Remote — backend relay.

This service is a DUMB, UNTRUSTED, AGENT-AGNOSTIC relay. It authenticates
nothing yet (see TODOs), understands nothing about any particular CLI agent,
and never calls an LLM. Its only job is:

  1. Let devagents (laptops) and phones register under an id.
  2. Forward messages between them by device_id, verbatim, unparsed beyond
     the routing fields it needs (`type`, `device_id`).

See ../docs/PROTOCOL.md for the full message protocol this relays.

TODO(auth): both endpoints accept any register message today. Add a token/JWT
check before admitting a connection to a registry (e.g. verify a `token`
field on the register message against a user/device table).

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

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from registry import ConnectionRegistry

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("devagent-relay")

app = FastAPI(title="DevAgent Remote Backend")

# Two independent registries: one for laptop-side devagents, one for phones.
agents = ConnectionRegistry()
phones = ConnectionRegistry()


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
        phone_id = await _register(websocket, phones, id_field="phone_id")
        if phone_id is None:
            return

        logger.info("phone connected: phone_id=%s", phone_id)
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
