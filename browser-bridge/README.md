# ChatGPT Browser Bridge adapter

This project uses the existing open-source `DrA1ex/chatgpt-bridge` as the browser transport. We do not vendor or modify that project here.

Upstream repository:
https://github.com/DrA1ex/chatgpt-bridge

## Current upstream setup

The upstream bridge requires Node.js 20+, npm, Chrome/Chromium, and a ChatGPT session already logged into `https://chatgpt.com`. It runs its local HTTP server on `http://127.0.0.1:8080` by default. The upstream setup flow is available at `/setup`; the extension is installed with `npm run extension:install` and then loaded as an unpacked extension in Chrome. See the upstream README for the current installation procedure.

## Security

Keep the bridge bound to `127.0.0.1`. The bridge supports a separate API token for its HTTP API and a browser bridge token for the extension. Do not expose the bridge port publicly.

## Integration contract

The local orchestrator calls:

```http
POST http://127.0.0.1:8080/chat
Authorization: Bearer $CHATGPT_BRIDGE_TOKEN
Content-Type: application/json

{"message":"..."}
```

Expected response:

```json
{"response":"..."}
```

The orchestrator converts ChatGPT's response into the strict action protocol defined in `docs/ACTION_PROTOCOL.md` and passes only structured actions to the local MCP server.

Upstream API behavior is documented at:
https://github.com/DrA1ex/chatgpt-bridge#http-api
