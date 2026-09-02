# Local Coding AI Agent

A local coding-agent bridge where **ChatGPT Go is the reasoning brain** and a local MCP executor performs controlled actions on the developer machine.

## Final architecture

```text
ChatGPT Go
   |
   | ChatGPT Web UI
   v
Chrome extension
   |
   | localhost HTTP
   v
Local relay (Node.js)
   |
   | Google OAuth -> short-lived session
   v
Python MCP server
   |
   +-------------------+
   |        |          |
 Files    Shell       Git
   |        |          |
   +--------+----------+
            |
            v
       Local project
```

The browser extension is a **UI adapter**, not a native ChatGPT MCP connector. It places ChatGPT into a structured agent mode, watches assistant messages for explicit action markers, sends one action at a time to the local relay, and posts the result back into the same ChatGPT conversation.

## Security principles

- No Codex dependency.
- No OpenAI API key or API billing in the local execution path.
- Google OAuth is used only to authenticate the allowed user; Google access credentials are not persisted by the relay.
- The relay binds only to `127.0.0.1`.
- The extension receives a short-lived 30-minute session rather than a permanent master token.
- Sessions are scoped to read-only access initially.
- `list_files`, `read_file`, `search_files`, `git_status`, and `git_diff` are enabled.
- `write_file` and `apply_patch` are disabled in the relay until explicitly enabled.
- `run_command` is disabled by default at the MCP server with a separate `ALLOW_EXEC` switch.
- Filesystem access is confined to `PROJECT_ROOT`.
- Shell execution uses an executable allowlist and `shell=False` when execution is enabled.
- Audit events are written locally without file contents or credentials.

## Components

- `browser-extension/` — Chrome Manifest V3 extension for ChatGPT Web.
- `relay/` — Node.js localhost relay, Google OAuth handler, session manager, and MCP client.
- `mcp-server/` — Python MCP tool server.
- `orchestrator/` — earlier experimental API-based loop; retained for reference and not used by the browser relay path.
- `docs/` — protocol and architecture documentation.

## Current status

The relay and browser extension now use Google OAuth instead of the previous persistent bearer-token design. The first phase is intentionally read-only so the authentication and browser-agent loop can be validated before write or command capabilities are enabled.

## Setup

See `relay/README.md` for Google Cloud OAuth setup, the allowed-account configuration, and Mac launch commands. Never commit OAuth credentials or local environment files.

## Security note

This browser adapter is unofficial UI automation. ChatGPT DOM structure can change, so the extension keeps the local relay independent and uses explicit action markers rather than interpreting arbitrary natural-language assistant output as commands.
