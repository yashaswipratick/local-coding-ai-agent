# Browser relay

This extension is the ChatGPT Web adapter for the local coding agent. It does not use the OpenAI API or Codex. It observes assistant messages in a ChatGPT tab for explicit action markers, sends those structured actions to the local relay, and posts the tool result back into the same chat.

## Authentication

The extension no longer asks for or stores a permanent relay token. Authentication is:

**Google OAuth → 30-minute read-only local session**

The relay accepts only the exact Google account configured by `ALLOWED_GOOGLE_EMAIL`. The local session is kept in the extension's local storage only for the current session and can be revoked with **Sign out**.

## Install in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `browser-extension/` directory.
5. Open `https://chatgpt.com/` and make sure you are signed in.
6. Open the extension popup and verify the relay URL is `http://127.0.0.1:8787`.
7. Click **Sign in with Google** and complete sign-in using the allowed account.
8. Click **Start Agent Mode in current ChatGPT tab**.

## Action protocol

The extension only reacts to assistant messages containing explicit action markers:

```text
[[LOCAL_CODING_AGENT_ACTION]]
{ "type": "action", "request_id": "...", "tool": "read_file", "arguments": { "path": "README.md" } }
[[/LOCAL_CODING_AGENT_ACTION]]
```

A completion can use `"type":"done"` in the same markers. Natural-language text outside the markers is never executed.

## Current security mode

Only read-only local tools are enabled initially: `list_files`, `read_file`, `search_files`, `git_status`, and `git_diff`.

File writes, patches, and command execution are intentionally blocked until the authentication and action flow has been tested. This prevents an authenticated browser session from becoming a remote code-execution path by default.

## Limitations

This is a browser-UI adapter, not a native ChatGPT MCP connector. ChatGPT DOM selectors can change over time. The extension therefore uses multiple fallbacks and keeps the local relay independent of the browser UI.
