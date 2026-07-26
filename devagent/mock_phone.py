"""Tiny CLI stand-in for the phone app, for testing the devagent + backend
without the real Expo app.

Connects to the backend's /ws/phone, registers, lists a device's registered
projects (projects.list/projects), sends one task.start by project_id,
prints every streamed log and the final task.result, then offers to send a
task.revert back to the checkpoint that task started from.
"""

from __future__ import annotations

import asyncio
import json
import sys

import websockets

BACKEND_PHONE_URL = "ws://localhost:8000/ws/phone"


async def main() -> None:
    device_id = input("device_id to target [laptop-1]: ").strip() or "laptop-1"

    async with websockets.connect(BACKEND_PHONE_URL) as ws:
        await ws.send(json.dumps({"type": "register", "phone_id": "mock-phone"}))
        reply = json.loads(await ws.recv())
        print(f"[backend] {reply}")
        if device_id not in reply.get("online", []):
            print(f"warning: {device_id!r} is not currently registered as online")

        await ws.send(json.dumps({"type": "projects.list", "device_id": device_id}))
        projects_msg = json.loads(await ws.recv())
        if projects_msg.get("type") != "projects":
            print(f"[unexpected reply] {projects_msg}")
            return

        projects = projects_msg.get("projects", [])
        if not projects:
            print("no projects registered on that device (use manage_projects.py add)")
            return

        print("\nregistered projects:")
        for i, project in enumerate(projects):
            print(
                f"  [{i}] {project['display_name']} "
                f"(project_id={project['project_id']}, branch={project.get('current_branch')})"
            )

        index = int(input("\npick a project by index: ").strip())
        project_id = projects[index]["project_id"]

        agent = input("agent [claude]: ").strip() or "claude"
        prompt = input("prompt: ").strip()
        if not prompt:
            print("no prompt given, exiting")
            return

        task_id = "mock-task-1"
        await ws.send(json.dumps({
            "type": "task.start",
            "task_id": task_id,
            "device_id": device_id,
            "agent": agent,
            "project_id": project_id,
            "prompt": prompt,
        }))
        print(f"[sent] task.start task_id={task_id!r}\n")

        checkpoint = None
        async for raw in ws:
            message = json.loads(raw)
            msg_type = message.get("type")

            if msg_type == "log":
                data = message.get("data")
                print(f"[log] {data}")
                if isinstance(data, dict) and data.get("kind") == "checkpoint":
                    checkpoint = data.get("checkpoint")
            elif msg_type == "approval.request":
                print(f"\n[approval.request] {message['tool']}: {message['input']}")
                answer = input("approve? [y/N]: ").strip().lower()
                await ws.send(json.dumps({
                    "type": "approval.response",
                    "req_id": message["req_id"],
                    "allow": answer == "y",
                }))
            elif msg_type == "task.result":
                print(f"\n[task.result] {message}")
                checkpoint = message.get("checkpoint", checkpoint)
                break
            elif msg_type == "error":
                print(f"[error] {message}")
                break
            else:
                print(f"[?] {message}")

        if checkpoint:
            answer = input(
                f"\nrevert project {project_id!r} to checkpoint {checkpoint}? [y/N]: "
            ).strip().lower()
            if answer == "y":
                await ws.send(json.dumps({
                    "type": "task.revert",
                    "task_id": task_id,
                    "device_id": device_id,
                    "project_id": project_id,
                    "checkpoint": checkpoint,
                }))
                raw = await ws.recv()
                print(f"[revert reply] {json.loads(raw)}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
