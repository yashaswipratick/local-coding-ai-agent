# Local Orchestrator

The orchestrator is the local control loop between a logged-in ChatGPT browser session and the local MCP server.

## Flow

```text
ChatGPT Go browser session
        |
        v
ChatGPT Browser Bridge (localhost:8080)
        |
        v
orchestrator
        |
        v
MCP server (stdio subprocess)
        |
        v
project files / shell / git
```

The orchestrator asks ChatGPT for exactly one structured action at a time. It executes that action through MCP, sends the tool result back to ChatGPT, and repeats until ChatGPT returns `done`.

## Prerequisites

- Python 3.11+
- Node.js 20+
- A logged-in Chrome/Chromium ChatGPT tab
- The third-party ChatGPT Browser Bridge running on `127.0.0.1:8080`
- This repository checked out locally

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r orchestrator/requirements.txt
python -m pip install -r mcp-server/requirements.txt
```

## Run

From the repository root:

```bash
PROJECT_ROOT=/Users/$USER/Projects/investment \
python orchestrator/orchestrator.py \
  "Inspect the project and explain why the Cassandra export is failing. Do not modify files yet."
```

The browser bridge URL defaults to `http://127.0.0.1:8080`.

Set `CHATGPT_BRIDGE_TOKEN` if the bridge was configured with authentication.

## Safety

The MCP server remains the authority for file/path and shell restrictions. The orchestrator does not execute natural-language responses directly; only validated JSON action envelopes are passed to MCP.

Start with read-only tasks. Enable write operations only after verifying the local checkout and project root.
