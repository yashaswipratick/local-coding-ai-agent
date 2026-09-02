import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const HOST = '127.0.0.1';
const PORT = Number(process.env.RELAY_PORT || 8787);
const PROJECT_ROOT = path.resolve(process.env.PROJECT_ROOT || process.cwd());
const PYTHON_BIN = process.env.MCP_PYTHON || path.join(PROJECT_ROOT, 'mcp-server', '.venv', 'bin', 'python');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ALLOWED_GOOGLE_EMAIL = (process.env.ALLOWED_GOOGLE_EMAIL || '').trim().toLowerCase();
const EXTENSION_ORIGIN = (process.env.EXTENSION_ORIGIN || '').trim();
const SESSION_TTL_MS = 30 * 60 * 1000;
const AUTH_TTL_MS = 5 * 60 * 1000;
const MAX_BODY = 1024 * 1024;
const AUDIT_FILE = path.join(process.env.HOME || process.cwd(), '.local-coding-ai-agent', 'audit.jsonl');
const READ_TOOLS = new Set(['list_files', 'read_file', 'search_files', 'git_status', 'git_diff']);
const DISABLED_TOOLS = new Set(['write_file', 'apply_patch', 'run_command']);
const sessions = new Map();
const pendingAuth = new Map();
let mcpClient;
let mcpTransport;
let connecting;

function b64url(buffer) { return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function randomToken(bytes = 32) { return b64url(crypto.randomBytes(bytes)); }
function pkceChallenge(verifier) { return b64url(crypto.createHash('sha256').update(verifier).digest()); }
function safeEqual(a, b) {
  const aa = Buffer.from(a || ''); const bb = Buffer.from(b || '');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function requestOriginAllowed(req) { return !EXTENSION_ORIGIN || (req.headers.origin || '') === EXTENSION_ORIGIN; }
function bearer(req) { const value = req.headers.authorization || ''; return value.startsWith('Bearer ') ? value.slice(7) : ''; }
function getSession(req) {
  const token = bearer(req); const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() >= session.expiresAt) { sessions.delete(token); return null; }
  return { token, ...session };
}
function audit(entry) {
  try {
    fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true, mode: 0o700 });
    fs.appendFileSync(AUDIT_FILE, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 });
  } catch (err) { console.error('Audit log failed:', err.message || err); }
}
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': EXTENSION_ORIGIN || '*', 'Access-Control-Allow-Headers': 'content-type, authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Vary': 'Origin' });
  res.end(body);
}
function redirect(res, location) { res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' }); res.end(); }
async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw new Error('request body too large'); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}
async function getMcpClient() {
  if (mcpClient) return mcpClient;
  if (connecting) return connecting;
  connecting = (async () => {
    mcpTransport = new StdioClientTransport({ command: PYTHON_BIN, args: [path.join(PROJECT_ROOT, 'mcp-server', 'server.py')], cwd: PROJECT_ROOT, env: { ...process.env, PROJECT_ROOT } });
    const client = new Client({ name: 'local-coding-ai-agent-relay', version: '0.2.0' });
    await client.connect(mcpTransport); mcpClient = client; return client;
  })();
  try { return await connecting; } finally { connecting = undefined; }
}
function requireSession(req, res) {
  if (!requestOriginAllowed(req)) { sendJson(res, 403, { ok: false, error: 'origin not allowed' }); return null; }
  const session = getSession(req);
  if (!session) { sendJson(res, 401, { ok: false, error: 'session expired or unauthorized' }); return null; }
  return session;
}
async function handleAction(req, res) {
  const session = requireSession(req, res); if (!session) return;
  let payload;
  try { payload = JSON.parse(await readBody(req)); } catch (err) { return sendJson(res, 400, { ok: false, error: String(err.message || err) }); }
  if (payload?.type !== 'action' || typeof payload.tool !== 'string' || !payload.arguments || typeof payload.arguments !== 'object') return sendJson(res, 400, { ok: false, error: 'invalid action envelope' });
  if (DISABLED_TOOLS.has(payload.tool)) { audit({ user: session.email, tool: payload.tool, status: 'blocked', reason: 'capability_disabled' }); return sendJson(res, 403, { ok: false, error: `${payload.tool} is disabled in secure read-only mode` }); }
  if (!READ_TOOLS.has(payload.tool)) { audit({ user: session.email, tool: payload.tool, status: 'blocked', reason: 'tool_not_allowed' }); return sendJson(res, 403, { ok: false, error: `tool not allowed: ${payload.tool}` }); }
  try {
    const client = await getMcpClient();
    const result = await client.callTool({ name: payload.tool, arguments: payload.arguments });
    const content = (result.content || []).map((item) => item?.type === 'text' ? item.text : JSON.stringify(item));
    audit({ user: session.email, tool: payload.tool, status: result.isError ? 'error' : 'ok' });
    return sendJson(res, 200, { type: 'result', request_id: payload.request_id ?? null, ok: !result.isError, result: content.join('\n') });
  } catch (err) { audit({ user: session.email, tool: payload.tool, status: 'error' }); return sendJson(res, 500, { type: 'result', request_id: payload.request_id ?? null, ok: false, error: String(err?.message || err) }); }
}
function authStart(res) {
  if (!GOOGLE_CLIENT_ID || !ALLOWED_GOOGLE_EMAIL) return sendJson(res, 500, { ok: false, error: 'GOOGLE_CLIENT_ID and ALLOWED_GOOGLE_EMAIL must be configured' });
  const state = randomToken(24); const verifier = randomToken(48); const redirectUri = `http://${HOST}:${PORT}/oauth/callback`;
  pendingAuth.set(state, { verifier, createdAt: Date.now() });
  const params = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', access_type: 'online', prompt: 'select_account', state, code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256' });
  return sendJson(res, 200, { ok: true, state, auth_url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, expires_in_seconds: AUTH_TTL_MS / 1000 });
}
async function oauthCallback(req, res, url) {
  const state = url.searchParams.get('state') || ''; const code = url.searchParams.get('code') || ''; const error = url.searchParams.get('error') || '';
  const pending = pendingAuth.get(state);
  if (!pending || Date.now() - pending.createdAt > AUTH_TTL_MS) { pendingAuth.delete(state); return sendJson(res, 400, { ok: false, error: 'invalid or expired OAuth state' }); }
  if (error) { pendingAuth.delete(state); pendingAuth.set(state, { completedAt: Date.now(), error: `Google OAuth failed: ${error}` }); return redirect(res, `http://${HOST}:${PORT}/oauth/result?state=${encodeURIComponent(state)}`); }
  if (!code) return sendJson(res, 400, { ok: false, error: 'missing OAuth code' });
  try {
    const redirectUri = `http://${HOST}:${PORT}/oauth/callback`;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, code, code_verifier: pending.verifier, grant_type: 'authorization_code', redirect_uri: redirectUri }) });
    if (!tokenResponse.ok) throw new Error(`Google token exchange failed (${tokenResponse.status})`);
    const token = await tokenResponse.json();
    const userResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (!userResponse.ok) throw new Error(`Google userinfo failed (${userResponse.status})`);
    const user = await userResponse.json(); const email = String(user.email || '').trim().toLowerCase();
    if (!user.email_verified || !safeEqual(email, ALLOWED_GOOGLE_EMAIL)) throw new Error('authenticated Google account is not the configured allowed account');
    const sessionToken = randomToken(32);
    sessions.set(sessionToken, { email, issuedAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS, capabilities: ['read'] });
    pendingAuth.delete(state); pendingAuth.set(state, { completedAt: Date.now(), sessionToken, email });
    audit({ user: email, event: 'oauth_login', status: 'ok' });
    return redirect(res, `http://${HOST}:${PORT}/oauth/result?state=${encodeURIComponent(state)}`);
  } catch (err) {
    pendingAuth.delete(state); pendingAuth.set(state, { completedAt: Date.now(), error: String(err.message || err) });
    audit({ event: 'oauth_login', status: 'error' });
    return redirect(res, `http://${HOST}:${PORT}/oauth/result?state=${encodeURIComponent(state)}`);
  }
}
function authStatus(res, url) {
  const state = url.searchParams.get('state') || ''; const pending = pendingAuth.get(state);
  if (!pending) return sendJson(res, 404, { ok: false, error: 'unknown auth state' });
  if (!pending.completedAt) return sendJson(res, 200, { ok: true, status: 'pending' });
  pendingAuth.delete(state);
  if (pending.error) return sendJson(res, 200, { ok: false, status: 'error', error: pending.error });
  return sendJson(res, 200, { ok: true, status: 'authenticated', email: pending.email, session_token: pending.sessionToken, expires_in_seconds: SESSION_TTL_MS / 1000 });
}
function logout(req, res) {
  const session = requireSession(req, res); if (!session) return;
  sessions.delete(session.token); audit({ user: session.email, event: 'logout', status: 'ok' }); return sendJson(res, 200, { ok: true });
}
async function main() {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') { if (!requestOriginAllowed(req)) return sendJson(res, 403, { ok: false, error: 'origin not allowed' }); return sendJson(res, 204, {}); }
      const url = new URL(req.url, `http://${HOST}:${PORT}`);
      if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true, service: 'local-coding-ai-agent-relay', auth: 'google-oauth', mode: 'read-only', project_root: PROJECT_ROOT });
      if (req.method === 'GET' && url.pathname === '/auth/start') return authStart(res);
      if (req.method === 'GET' && url.pathname === '/oauth/callback') return await oauthCallback(req, res, url);
      if (req.method === 'GET' && url.pathname === '/auth/status') return authStatus(res, url);
      if (req.method === 'POST' && url.pathname === '/logout') return logout(req, res);
      if (req.method === 'POST' && url.pathname === '/action') return await handleAction(req, res);
      return sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (err) { console.error(err); return sendJson(res, 500, { ok: false, error: String(err.message || err) }); }
  });
  server.listen(PORT, HOST, () => {
    console.error(`Local Coding AI relay listening on http://${HOST}:${PORT}`);
    console.error(`PROJECT_ROOT=${PROJECT_ROOT}`); console.error(`MCP_PYTHON=${PYTHON_BIN}`);
    console.error('Authentication: Google OAuth + short-lived read-only session');
    console.error(`Allowed account: ${ALLOWED_GOOGLE_EMAIL || '[NOT CONFIGURED]'}`);
    console.error(`Google client ID: ${GOOGLE_CLIENT_ID ? '[CONFIGURED]' : '[NOT CONFIGURED]'}`);
    console.error(`Extension origin lock: ${EXTENSION_ORIGIN || '[not set]'}`); console.error(`Audit log: ${AUDIT_FILE}`);
  });
  const cleanup = setInterval(() => { const now = Date.now(); for (const [token, session] of sessions) if (now >= session.expiresAt) sessions.delete(token); for (const [state, auth] of pendingAuth) if (now - (auth.createdAt || auth.completedAt || now) > AUTH_TTL_MS) pendingAuth.delete(state); }, 60_000);
  const shutdown = async () => { clearInterval(cleanup); sessions.clear(); pendingAuth.clear(); try { await mcpClient?.close(); } catch {} try { await mcpTransport?.close(); } catch {} server.close(() => process.exit(0)); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
main().catch((err) => { console.error(err); process.exit(1); });
