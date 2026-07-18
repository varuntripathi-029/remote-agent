"""Git-based checkpoint/revert safety net around every task.

Nothing a remote task does to a project should be unrecoverable: every task
starts with a commit (checkpoint, even if nothing changed) and can be undone
by resetting back to it. This is the only module that shells out to git.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path


class NotAGitRepoError(Exception):
    pass


class GitCommandError(Exception):
    pass


async def _run_git(project_path: Path, *args: str) -> str:
    proc = await asyncio.create_subprocess_exec(
        "git", *args,
        cwd=str(project_path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise GitCommandError(
            f"git {' '.join(args)} failed (exit {proc.returncode}): "
            f"{stderr.decode(errors='replace').strip()}"
        )
    return stdout.decode(errors="replace")


async def is_git_repo(project_path: Path) -> bool:
    try:
        await _run_git(project_path, "rev-parse", "--is-inside-work-tree")
        return True
    except GitCommandError:
        return False


async def checkpoint(project_path: Path, task_id: str) -> str:
    """Snapshot the working tree before a task runs. Returns the commit SHA.

    Uses --allow-empty so a checkpoint always exists (and is revertible to)
    even when the working tree was already clean.
    """
    if not await is_git_repo(project_path):
        raise NotAGitRepoError(f"{project_path} is not a git repository")

    await _run_git(project_path, "add", "-A")
    await _run_git(project_path, "commit", "--allow-empty", "-m", f"devagent checkpoint {task_id}")
    sha = await _run_git(project_path, "rev-parse", "HEAD")
    return sha.strip()


@dataclass
class ChangeSummary:
    files: list[str]
    stat: dict[str, int]


async def summarize(project_path: Path) -> ChangeSummary:
    """Summarize what the agent changed in the working tree since checkpoint()."""
    # `-N` (intent-to-add) stages new files without their content, so they
    # show up in `git diff` output instead of being invisible (untracked).
    await _run_git(project_path, "add", "-A", "-N")

    name_status = await _run_git(project_path, "diff", "--name-status")
    files = [_last_column(line) for line in name_status.splitlines() if line.strip()]

    stat_text = await _run_git(project_path, "diff", "--stat")
    stat = _parse_diff_stat(stat_text)

    return ChangeSummary(files=files, stat=stat)


def _last_column(diff_name_status_line: str) -> str:
    # Rename/copy lines look like "R100\told\tnew" — the new path is what
    # matters; add/modify/delete lines are "M\tpath" (one path already).
    return diff_name_status_line.split("\t")[-1]


def _parse_diff_stat(stat_text: str) -> dict[str, int]:
    # `git diff --stat` ends with a summary line such as:
    #   " 2 files changed, 12 insertions(+), 3 deletions(-)"
    # Per-file lines above it aren't needed since name-status already lists them.
    stat = {"insertions": 0, "deletions": 0}
    lines = [line for line in stat_text.splitlines() if line.strip()]
    if not lines:
        return stat

    summary_line = lines[-1]
    for part in summary_line.split(","):
        part = part.strip()
        if "insertion" in part:
            stat["insertions"] = int(part.split()[0])
        elif "deletion" in part:
            stat["deletions"] = int(part.split()[0])
    return stat


async def revert(project_path: Path, checkpoint_sha: str) -> None:
    """Roll back to a checkpoint commit and remove any files created since."""
    await _run_git(project_path, "reset", "--hard", checkpoint_sha)
    await _run_git(project_path, "clean", "-fd")


async def resolve_git_root(project_path: Path) -> Path:
    """Resolve the repo root for a path that may be a subdirectory of it."""
    out = await _run_git(project_path, "rev-parse", "--show-toplevel")
    return Path(out.strip())


async def current_branch(project_path: Path) -> str:
    """Live branch name, for display in a projects.list reply. Empty string
    (e.g. detached HEAD) rather than raising — this is metadata, not a
    precondition for anything."""
    try:
        return (await _run_git(project_path, "rev-parse", "--abbrev-ref", "HEAD")).strip()
    except GitCommandError:
        return ""


async def last_commit_hash(project_path: Path) -> str:
    """Live HEAD commit SHA, for display in a projects.list reply."""
    try:
        return (await _run_git(project_path, "rev-parse", "HEAD")).strip()
    except GitCommandError:
        return ""


async def remote_url(project_path: Path) -> str | None:
    """Live `origin` remote URL, or None if there isn't one."""
    try:
        url = (await _run_git(project_path, "remote", "get-url", "origin")).strip()
        return url or None
    except GitCommandError:
        return None
