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
import uuid
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_CONFIG_PATH = Path(__file__).parent / "projects.json"


class ProjectAlreadyRegisteredError(Exception):
    def __init__(self, existing: "Project"):
        self.existing = existing
        super().__init__(
            f"{existing.local_path} is already registered as {existing.display_name!r} "
            f"(project_id={existing.project_id})"
        )


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
    config_path: Path = field(default=DEFAULT_CONFIG_PATH)

    def resolve_project(self, project_id: str) -> Project | None:
        return self.projects.get(project_id)

    def register_project(self, display_name: str, git_root: Path) -> Project:
        """Add a new project to the registry and persist it to disk.

        `git_root` must already be validated (exists, is a git repo, resolved
        to the repo root) by the caller — same contract as
        manage_projects.py's add_project, just reachable over the wire too
        now (project.register in docs/PROTOCOL.md) instead of only the CLI.
        """
        for project in self.projects.values():
            if project.local_path == git_root:
                raise ProjectAlreadyRegisteredError(project)

        project = Project(
            project_id=str(uuid.uuid4()), display_name=display_name, local_path=git_root
        )
        self.projects[project.project_id] = project
        self._persist()
        return project

    def _persist(self) -> None:
        raw = {
            "device_id": self.device_id,
            "backend_url": self.backend_url,
            "projects": [
                {
                    "project_id": p.project_id,
                    "display_name": p.display_name,
                    "local_path": str(p.local_path),
                }
                for p in self.projects.values()
            ],
        }
        self.config_path.write_text(json.dumps(raw, indent=2) + "\n")


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
        config_path=config_path,
    )
