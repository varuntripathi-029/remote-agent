"""Devagent configuration: project allowlist, backend URL, device_id.

Loaded from a JSON file (default: projects.json next to this module, override
with the DEVAGENT_CONFIG env var). `projects` is the security boundary
between a remote task.start/task.revert message and the local filesystem: a
project_id that isn't in this file is refused by main.py no matter what a
phone sends.

Per aim.md §5, projects are addressed everywhere outside this laptop by
`project_id` (a UUID generated here) — never by `local_path`. The backend and
phone never see `local_path`. Projects are registered with manage_projects.py
(validates the path is a git repo, resolves the repo root, generates the
project_id), never by scanning the filesystem.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_CONFIG_PATH = Path(__file__).parent / "projects.json"


@dataclass
class Project:
    project_id: str
    display_name: str
    local_path: Path


@dataclass
class Config:
    device_id: str
    backend_url: str
    projects: dict[str, Project]  # project_id -> Project

    def resolve_project(self, project_id: str) -> Project | None:
        return self.projects.get(project_id)


def load_config(path: Path | None = None) -> Config:
    config_path = path or Path(os.environ.get("DEVAGENT_CONFIG", str(DEFAULT_CONFIG_PATH)))
    if not config_path.exists():
        raise FileNotFoundError(
            f"devagent config not found at {config_path}. Copy "
            f"projects.example.json to projects.json, edit device_id/"
            f"backend_url, then register a project with "
            f"`python manage_projects.py add <display_name> <local_path>` "
            f"(or set DEVAGENT_CONFIG to point elsewhere)."
        )

    raw = json.loads(config_path.read_text())

    projects = {
        entry["project_id"]: Project(
            project_id=entry["project_id"],
            display_name=entry["display_name"],
            local_path=Path(entry["local_path"]).resolve(),
        )
        for entry in raw.get("projects", [])
    }

    return Config(
        device_id=raw["device_id"],
        backend_url=raw["backend_url"],
        projects=projects,
    )
