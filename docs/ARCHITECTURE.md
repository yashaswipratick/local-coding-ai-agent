# Architecture

## Goal

Use ChatGPT as the reasoning/brain layer while a local deterministic executor performs actions against a developer-selected project through MCP.

## Components

### 1. ChatGPT

Produces reasoning and structured actions. It is not given direct filesystem access by this project.

### 2. Browser bridge / relay

Adapter between the ChatGPT web session and the local orchestrator. This is intentionally isolated from the MCP implementation so another transport can replace it later.

### 3. Local orchestrator

Receives a task/result exchange with the bridge, validates the structured action envelope, and invokes the corresponding MCP tool.

### 4. MCP server

Exposes deterministic tools:

- `list_files`
- `read_file`
- `search_files`
- `write_file`
- `apply_patch`
- `run_command`
- `git_status`
- `git_diff`

### 5. Project workspace

All filesystem operations are constrained to the configured project root, e.g. `~/Projects/investment`.

## Action loop

```text
User request
   |
   v
ChatGPT reasoning
   |
   v
Structured action
   |
   v
Browser relay
   |
   v
Local orchestrator
   |
   v
MCP tool
   |
   v
Mac / project
   |
   v
Tool result
   |
   v
ChatGPT reasoning
   |
   +---- next action
```

## Why the local side is deterministic

The local component should not reinterpret natural-language instructions. ChatGPT supplies an explicit tool name and parameters; the local executor validates policy and performs that operation. This minimizes unintended changes and makes actions auditable.

## Security boundaries

1. Filesystem root is explicit and mandatory.
2. Path traversal outside the root is rejected.
3. Shell execution is allowlisted rather than arbitrary by default.
4. Git operations exposed initially are read-only.
5. Write operations should support an approval mode before enabling autonomous execution.
6. Secrets such as SSH keys, cloud credentials, and environment files should not be exposed as part of the workspace.
