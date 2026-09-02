# Local relay

The relay is the local HTTP adapter between the ChatGPT browser extension and the MCP server. It starts the Python MCP server as a child process over stdio and exposes a token-protected `/action` endpoint on localhost.

## Configuration

`PROJECT_ROOT` must be the project the agent is allowed to operate on. For the user's development setup this should point at the local checkout of the target project, not this agent repository.

Optional variables:

- `PROJECT_ROOT` — local project directory.
- `MCP_PYTHON` — Python executable used to start `mcp-server/server.py`.
- `RELAY_PORT` — default `8787`.
- `RELAY_TOKEN` — optional explicit token; otherwise a random token is stored under `~/.local-coding-ai-agent/relay-token`.
- `ALLOW_WRITES` — default `false`; set to `true` only when you are ready to permit `write_file` and `apply_patch`.

## Install

```bash
cd relay
npm install
```

## Run against a project

From the repository root:

```bash
PROJECT_ROOT=/absolute/path/to/your/project \
MCP_PYTHON=/absolute/path/to/this/repo/mcp-server/.venv/bin/python \
node relay/server.js
```

The relay prints the token file location. Read the token with:

```bash
cat ~/.local-coding-ai-agent/relay-token
```

Do not commit the token.

## Endpoints

- `GET /health` — local health check.
- `POST /action` — execute one structured MCP action. Requires `Authorization: Bearer <token>`.

The relay intentionally does not expose a generic shell HTTP endpoint; callers must use the MCP tool contract and the MCP server's own command allowlist.
