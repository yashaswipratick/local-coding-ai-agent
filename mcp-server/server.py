from __future__ import annotations

import os
import shlex
import subprocess
from pathlib import Path

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("local-coding-ai-agent")

PROJECT_ROOT = Path(os.environ.get("PROJECT_ROOT", os.getcwd())).expanduser().resolve()

# Conservative initial allowlist. Expand deliberately as needed.
ALLOWED_COMMANDS = {
    "python3",
    "python",
    "mvn",
    "./mvnw",
    "gradle",
    "./gradlew",
    "git",
    "find",
    "grep",
    "rg",
    "ls",
    "pwd",
}


def resolve_path(relative_path: str) -> Path:
    if not relative_path or Path(relative_path).is_absolute():
        raise ValueError("path must be a non-empty relative path")
    candidate = (PROJECT_ROOT / relative_path).resolve()
    try:
        candidate.relative_to(PROJECT_ROOT)
    except ValueError as exc:
        raise ValueError("path escapes PROJECT_ROOT") from exc
    return candidate


def command_allowed(command: str) -> bool:
    parts = shlex.split(command)
    if not parts:
        return False
    executable = parts[0]
    return executable in ALLOWED_COMMANDS


@mcp.tool()
def list_files(path: str = ".") -> list[str]:
    """List immediate children of a project-relative directory."""
    directory = resolve_path(path)
    if not directory.exists():
        raise FileNotFoundError(path)
    if not directory.is_dir():
        raise NotADirectoryError(path)
    return sorted(item.name for item in directory.iterdir())


@mcp.tool()
def read_file(path: str) -> str:
    """Read a UTF-8 text file under PROJECT_ROOT."""
    file_path = resolve_path(path)
    if not file_path.is_file():
        raise FileNotFoundError(path)
    return file_path.read_text(encoding="utf-8")


@mcp.tool()
def search_files(query: str) -> list[str]:
    """Search UTF-8 text files for a literal query."""
    if not query:
        raise ValueError("query must not be empty")
    matches: list[str] = []
    for file_path in PROJECT_ROOT.rglob("*"):
        if not file_path.is_file():
            continue
        if any(part in {".git", "target", "build", "node_modules"} for part in file_path.parts):
            continue
        try:
            text = file_path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        if query in text:
            matches.append(str(file_path.relative_to(PROJECT_ROOT)))
    return sorted(matches)


@mcp.tool()
def write_file(path: str, content: str) -> str:
    """Write a UTF-8 text file under PROJECT_ROOT."""
    file_path = resolve_path(path)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(content, encoding="utf-8")
    return f"wrote {file_path.relative_to(PROJECT_ROOT)}"


@mcp.tool()
def apply_patch(path: str, old_text: str, new_text: str) -> str:
    """Replace exactly one occurrence of old_text in a project file."""
    file_path = resolve_path(path)
    if not file_path.is_file():
        raise FileNotFoundError(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old_text)
    if count != 1:
        raise ValueError(f"expected exactly one match, found {count}")
    file_path.write_text(text.replace(old_text, new_text, 1), encoding="utf-8")
    return f"patched {file_path.relative_to(PROJECT_ROOT)}"


@mcp.tool()
def run_command(command: str, timeout_seconds: int = 120) -> dict:
    """Run an allowlisted command with PROJECT_ROOT as the working directory."""
    if not command_allowed(command):
        raise PermissionError("command executable is not in ALLOWED_COMMANDS")
    completed = subprocess.run(
        command,
        cwd=PROJECT_ROOT,
        shell=True,
        text=True,
        capture_output=True,
        timeout=max(1, min(timeout_seconds, 600)),
    )
    return {
        "returncode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }


@mcp.tool()
def git_status() -> str:
    """Return git status for the project."""
    result = subprocess.run(
        ["git", "status", "--short", "--branch"],
        cwd=PROJECT_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    return result.stdout + result.stderr


@mcp.tool()
def git_diff() -> str:
    """Return the working-tree diff for the project."""
    result = subprocess.run(
        ["git", "diff", "--"],
        cwd=PROJECT_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    return result.stdout + result.stderr


if __name__ == "__main__":
    mcp.run(transport="stdio")
