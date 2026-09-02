# Local Coding AI Agent

A local coding-agent bridge where **ChatGPT Go is the reasoning brain** and a local MCP executor performs filesystem, shell, and Git actions on the developer machine.

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
   | MCP over stdio
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

## Principles

- No Codex dependency.
- No OpenAI API dependency in the local execution path.
- No local LLM required for the core architecture.
- The MCP executor performs structured actions; it does not independently reason about code.
- Filesystem access is confined to `PROJECT_ROOT`.
- Shell execution uses an executable allowlist and `shell=False`.
- `write_file` and `apply_patch` are disabled by default and require `ALLOW_WRITES=true`.
- The relay requires a local bearer token.

## Components

- `browser-extension/` — Chrome Manifest V3 extension for ChatGPT Web.
- `relay/` — Node.js localhost relay and MCP client.
- `mcp-server/` — Python MCP tool server.
- `orchestrator/` — earlier experimental API-based loop; retained for reference and not used by the browser relay path.
- `docs/` — protocol and architecture documentation.

## Current status

Core browser-relay implementation is now committed. The remaining work is Mac-side installation and end-to-end validation against a real ChatGPT Go browser session.

## Security note

The browser adapter is unofficial UI automation. ChatGPT DOM structure can change, so the extension keeps the local relay independent and uses explicit action markers rather than interpreting arbitrary natural-language assistant output as commands.
