# Local Coding AI Agent

A local coding-agent architecture where ChatGPT is the reasoning layer and a local MCP executor performs filesystem, shell, and Git actions on a developer machine.

## Architecture

```text
ChatGPT Go (brain)
        |
        | browser bridge / relay
        v
Local Orchestrator
        |
       MCP
        |
  +-----+-----+-----+
  |           |     |
Files       Shell  Git
  |           |     |
  +-----+-----+-----+
        |
        v
   Local project
```

## Design principles

- No Codex dependency for the local execution layer.
- No OpenAI API dependency for the core executor.
- The local executor is deterministic: it executes structured actions instead of independently reasoning about the task.
- Filesystem access is constrained to a configured project root.
- Shell commands are allowlisted.
- Destructive operations are intended to require explicit approval.
- The browser bridge is treated as an adapter; the MCP server remains independent of it.

## Planned components

- `mcp-server/` — local MCP tool server.
- `orchestrator/` — action loop between the ChatGPT bridge and MCP tools.
- `browser-bridge/` — integration notes/configuration for the ChatGPT browser bridge.
- `docs/` — architecture, protocol, and security documentation.

## Status

Initial repository bootstrap. The next commits will add the local MCP server, structured action protocol, orchestrator, and setup instructions for macOS.
