# Local MCP Server

## Requirements

- macOS/Linux
- Python 3.10+

## Setup

```bash
cd mcp-server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Set the project root before starting the server:

```bash
export PROJECT_ROOT="$HOME/Projects/investment"
python server.py
```

The server uses MCP stdio transport. An MCP client/orchestrator launches `server.py` and communicates over stdin/stdout.

## Safety model

The server rejects absolute paths and paths that resolve outside `PROJECT_ROOT`.

Shell execution is restricted to the executable allowlist in `server.py`. The initial implementation intentionally does not expose arbitrary shell commands or write-enabled Git operations.

Before using autonomous write mode, put the project under Git and inspect `git diff` after every action. `.env`, SSH credentials, cloud credentials, and other secrets should not be placed inside the exposed workspace.
