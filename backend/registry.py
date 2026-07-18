"""In-memory connection registries for devagents and phones.

M0 keeps everything in a process-local dict. The class boundary here exists so
a future revision can swap in Postgres-backed presence (e.g. for multiple
backend replicas) without touching the WebSocket handlers in main.py — they
only ever call register/unregister/get/all_ids.

TODO(persistence): replace the in-memory dict with a shared store (Postgres,
Redis) if the backend ever runs as more than one process, so all replicas see
the same set of connected devices/phones.
"""

from __future__ import annotations

from fastapi import WebSocket


class ConnectionRegistry:
    """Maps an id (device_id or phone_id) to its live WebSocket connection."""

    def __init__(self) -> None:
        self._connections: dict[str, WebSocket] = {}

    def register(self, conn_id: str, websocket: WebSocket) -> None:
        self._connections[conn_id] = websocket

    def unregister(self, conn_id: str) -> None:
        self._connections.pop(conn_id, None)

    def get(self, conn_id: str) -> WebSocket | None:
        return self._connections.get(conn_id)

    def all_ids(self) -> list[str]:
        return list(self._connections.keys())

    def all_sockets(self) -> list[WebSocket]:
        return list(self._connections.values())

    def __len__(self) -> int:
        return len(self._connections)
