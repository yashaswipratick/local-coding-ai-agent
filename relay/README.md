# Local relay

The relay is the local HTTP adapter between the ChatGPT browser extension and the Python MCP server. It is **localhost-only** and uses **Google OAuth to prove your identity**, then creates a short-lived in-memory session. No permanent relay token is written to disk.

## Security model

The relay binds only to `127.0.0.1`.

Google OAuth authenticates the user. The relay then accepts only the exact account configured by `ALLOWED_GOOGLE_EMAIL` and creates a 30-minute read-only session.

Read-only tools enabled initially:

- `list_files`
- `read_file`
- `search_files`
- `git_status`
- `git_diff`

These are deliberately disabled until a later security review:

- `write_file`
- `apply_patch`
- `run_command`

The relay also writes an audit trail to `~/.local-coding-ai-agent/audit.jsonl` without recording file contents or access credentials.

## Google OAuth setup

Create a Google OAuth 2.0 client for a desktop/installed application in Google Cloud. Add this exact redirect URI to the client if the console asks for one:

```text
http://127.0.0.1:8787/oauth/callback
```

Set these environment variables when starting the relay:

```bash
export GOOGLE_CLIENT_ID='YOUR_GOOGLE_CLIENT_ID'
export ALLOWED_GOOGLE_EMAIL='your-google-account@gmail.com'
```

`ALLOWED_GOOGLE_EMAIL` is the **only Google account that the relay will accept**.

Optional:

```bash
export EXTENSION_ORIGIN='chrome-extension://YOUR_EXTENSION_ID'
```

After loading the unpacked extension in Chrome, copy its extension ID into `EXTENSION_ORIGIN` and restart the relay. This adds an origin check on browser requests.

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
GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" \
ALLOWED_GOOGLE_EMAIL="$ALLOWED_GOOGLE_EMAIL" \
node relay/server.js
```

The relay will print which authentication mode is active. It will **not** print a reusable relay token.

## Extension flow

1. Load `browser-extension/` as an unpacked Chrome extension.
2. Open the extension popup.
3. Click **Sign in with Google**.
4. Complete Google sign-in using the configured account.
5. The extension receives a short-lived read-only session.
6. Click **Start Agent Mode in current ChatGPT tab**.

Sessions expire after 30 minutes and are also revoked immediately by **Sign out** or by restarting the relay.

## Endpoints

- `GET /health` — local health check.
- `GET /auth/start` — starts Google OAuth with PKCE.
- `GET /oauth/callback` — receives the Google authorization code.
- `GET /auth/status?state=...` — extension polls for the completed login.
- `POST /logout` — revokes the current session.
- `POST /action` — executes one allowed structured MCP action for the authenticated session.

The relay never exposes a generic shell HTTP endpoint.
