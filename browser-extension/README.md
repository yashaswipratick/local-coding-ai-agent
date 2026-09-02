# Browser relay

This extension is the ChatGPT Web adapter for the local coding agent. It does not use the OpenAI API or Codex. It observes assistant messages in a ChatGPT tab for explicit action markers, sends those structured actions to the local relay, and posts the tool result back into the same chat.

## Install in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `browser-extension/` directory.
5. Open `https://chatgpt.com/` and make sure you are signed in.
6. Open the extension popup, set the relay URL and token, then save.
7. Click **Start Agent Mode in current ChatGPT tab**.

## Action protocol

The extension only reacts to assistant messages containing:

```text
[[LOCAL_CODING_AGENT_ACTION]]
{ "type": "action", "request_id": "...", "tool": "read_file", "arguments": { "path": "README.md" } }
[[/LOCAL_CODING_AGENT_ACTION]]
```

A completion can use `"type":"done"` in the same markers. Natural-language text outside the markers is never executed.

## Limitations

This is a browser-UI adapter, not a native ChatGPT MCP connector. ChatGPT DOM selectors can change over time. The extension therefore uses multiple fallbacks and keeps the local relay independent of the browser UI.
