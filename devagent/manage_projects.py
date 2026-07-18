"""CLI to register/list/remove projects in projects.json.

This is the "DevAgent CLI" aim.md §5 refers to: projects are added manually
and explicitly here (never by the devagent scanning the filesystem). Adding
a project validates it's a real git repo and resolves the actual repo root,
then generates the stable `project_id` (UUID) that is the only thing the
backend and phone ever see — `local_path` never leaves this file.

Usage:
    python manage_projects.py add <display_name> <local_path>
    python manage_projects.py list
    python manage_projects.py remove <project_id>
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from pathlib import Path

import git_safety
from config import DEFAULT_CONFIG_PATH


def _load_raw(config_path: Path) -> dict:
    if not config_path.exists():
        return {
            "device_id": "laptop-1",
            "backend_url": "ws://localhost:8000/ws/agent",
            "projects": [],
        }
    return json.loads(config_path.read_text())


def _save_raw(config_path: Path, raw: dict) -> None:
    config_path.write_text(json.dumps(raw, indent=2) + "\n")


async def add_project(display_name: str, local_path_str: str, config_path: Path) -> None:
    local_path = Path(local_path_str).resolve()
    if not local_path.is_dir():
        print(f"error: {local_path} is not a directory", file=sys.stderr)
        sys.exit(1)

    if not await git_safety.is_git_repo(local_path):
        print(f"error: {local_path} is not a git repository (run 'git init' there first)", file=sys.stderr)
        sys.exit(1)

    # Resolve to the actual repo root, per aim.md §5, even if a subdirectory was given.
    git_root = await git_safety.resolve_git_root(local_path)

    raw = _load_raw(config_path)
    projects = raw.setdefault("projects", [])
    for entry in projects:
        if Path(entry["local_path"]).resolve() == git_root:
            print(
                f"error: {git_root} is already registered as {entry['display_name']!r} "
                f"(project_id={entry['project_id']})",
                file=sys.stderr,
            )
            sys.exit(1)

    project_id = str(uuid.uuid4())
    projects.append({
        "project_id": project_id,
        "display_name": display_name,
        "local_path": str(git_root),
    })
    _save_raw(config_path, raw)
    print(f"registered {display_name!r} -> {git_root} as project_id={project_id}")


def list_projects(config_path: Path) -> None:
    projects = _load_raw(config_path).get("projects", [])
    if not projects:
        print("no projects registered")
        return
    for entry in projects:
        print(f"{entry['project_id']}  {entry['display_name']!r}  {entry['local_path']}")


def remove_project(project_id: str, config_path: Path) -> None:
    raw = _load_raw(config_path)
    before = raw.get("projects", [])
    after = [p for p in before if p["project_id"] != project_id]
    if len(after) == len(before):
        print(f"error: no project with project_id={project_id}", file=sys.stderr)
        sys.exit(1)
    raw["projects"] = after
    _save_raw(config_path, raw)
    print(f"removed project_id={project_id}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage the devagent's local project registry.")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    sub = parser.add_subparsers(dest="command", required=True)

    add_parser = sub.add_parser("add", help="Register a new project")
    add_parser.add_argument("display_name")
    add_parser.add_argument("local_path")

    sub.add_parser("list", help="List registered projects")

    remove_parser = sub.add_parser("remove", help="Remove a registered project")
    remove_parser.add_argument("project_id")

    args = parser.parse_args()

    if args.command == "add":
        asyncio.run(add_project(args.display_name, args.local_path, args.config))
    elif args.command == "list":
        list_projects(args.config)
    elif args.command == "remove":
        remove_project(args.project_id, args.config)


if __name__ == "__main__":
    main()
