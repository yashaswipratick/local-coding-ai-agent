# Local relay

The relay is the local HTTP adapter between the ChatGPT browser extension and the Python MCP server. It is **localhost-only** and uses **Google OAuth to prove your identity**, then creates a short-lived in-memory session. No permanent relay token is written to disk.

## Security model

The relay binds only to `127.0.0.1`.

Google OAuth authenticates the user. The relay reads the OAuth credentials and allowed account **only from this exact local file on the user's Mac**:

```text
/Users/yashaswipratick/Documents/youtube-analytics/screts.json
```

The file must contain these exact JSON keys:

```json
{
  "client-id": "...",
  "client-secret": "...",
  "ALLOWED_GOOGLE_EMAIL": "..."
}
```

The file is never read from GitHub and is never sent to the browser extension.

After successful Google authentication, the relay accepts only the exact account from `ALLOWED_GOOGLE_EMAIL` and creates a 30-minute read-only session.

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

The Google OAuth client must have this exact redirect URI authorized:

```text
http://127.0.0.1:8787/oauth/callback
```

No Google credentials need to be exported as environment variables. The relay loads them from the local `screts.json` file above.

Optional origin lock:

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
node relay/server.js
```

The relay will print the local OAuth credential file path, but it will **never print the client secret or a reusable relay token**.

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
