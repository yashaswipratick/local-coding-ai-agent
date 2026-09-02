# Local relay

The relay is the local HTTP adapter between the ChatGPT browser extension and the Python MCP server. It is **localhost-only** and uses **Google OAuth to prove your identity**, then creates a short-lived in-memory session. No permanent relay token is written to disk.

## Local configuration

The relay reads its runtime configuration from this file:

```text
relay/local-config.json
```

This file is intentionally gitignored. Copy the template:

```bash
cp relay/local-config.example.json relay/local-config.json
```

Then set the project you want the agent to operate on:

```json
{
  "PROJECT_ROOT": "/Users/yashaswipratick/Documents/youtube-analytics",
  "RELAY_PORT": 8787,
  "EXTENSION_ORIGIN": ""
}
```

Change only `PROJECT_ROOT` when you want the agent to work on a different local project. No environment variable is required for `PROJECT_ROOT`.

The relay also uses this exact local Google OAuth credentials file:

```text
/Users/yashaswipratick/Documents/youtube-analytics/screts.json
```

It must contain:

```json
{
  "client-id": "...",
  "client-secret": "...",
  "ALLOWED_GOOGLE_EMAIL": "..."
}
```

Neither the local configuration nor OAuth secrets are committed to Git.

## Security model

The relay binds only to `127.0.0.1`.

Google OAuth authenticates the user. The relay accepts only the exact account from `ALLOWED_GOOGLE_EMAIL` and creates a 30-minute read-only session.

Read-only tools enabled initially:

- `list_files`
- `read_file`
- `search_files`
- `git_status`
- `git_diff`

These remain disabled until a later security review:

- `write_file`
- `apply_patch`
- `run_command`

The relay also writes an audit trail to `~/.local-coding-ai-agent/audit.jsonl` without recording file contents or access credentials.

## Google OAuth setup

The Google OAuth client must have this exact redirect URI authorized:

```text
http://127.0.0.1:8787/oauth/callback
```

No Google credentials need to be exported as environment variables. The relay loads them from the local `screts.json` file above.

Optional origin lock:

```json
{
  "PROJECT_ROOT": "/absolute/path/to/your/project",
  "RELAY_PORT": 8787,
  "EXTENSION_ORIGIN": "chrome-extension://YOUR_EXTENSION_ID"
}
```

After loading the unpacked extension in Chrome, put its extension ID into `EXTENSION_ORIGIN` and restart the relay. This adds an origin check on browser requests.

## Install

```bash
cd relay
npm install
```

## Run

The relay reads `PROJECT_ROOT` from `relay/local-config.json`:

```bash
cd relay
node server.js
```

The relay will print the configured project root and OAuth credential file path, but it will **never print the client secret or a reusable relay token**.

## Extension flow

1. Load `browser-extension/` as an unpacked Chrome extension.
2. Open the extension popup.
3. Click **Sign in with Google**.
4. Complete Google sign-in using the configured account.
5. The extension receives a short-lived read-only session.
6. Click **Start Agent Mode in current ChatGPT tab**.

Sessions expire after 30 minutes and are also revoked immediately by **Sign out** or by restarting the relay.
