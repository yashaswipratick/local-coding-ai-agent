import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const HOST = process.env.RELAY_HOST || '127.0.0.1';
const PORT = Number(process.env.RELAY_PORT || 8787);
const PROJECT_ROOT = path.resolve(process.env.PROJECT_ROOT || process.cwd());
const PYTHON_BIN = process.env.MCP_PYTHON || path.join(PROJECT_ROOT, 'mcp-server', '.venv', 'bin', 'python');
const TOKEN_FILE = path.join(process.env.HOME || process.cwd(), '.local-coding-ai-agent', 'relay-token');
const MAX_BODY = 1024 * 1024;

const ALLOWED_TOOLS = new Set([
  'list_files', 'read_file', 'search_files', 'write_file', 'apply_patch',
  'run_command', 'git_status', 'git_diff',
]);

function loadOrCreateToken() {
  if (process.env.RELAY_TOKEN) return process.env.RELAY_TOKEN;
  const dir = path.dirname(TOKEN_FILE);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (token) return token;
  } catch {}
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(TOKEN_FILE, token + '\n', { mode: 0o600 });
  return token;
}

const RELAY_TOKEN = loadOrCreateToken();
let mcpClient;
let mcpTransport;
let connecting;

async function getMcpClient() {
  if (mcpClient) return mcpClient;
  if (connecting) return connecting;
  connecting = (async () => {
    mcpTransport = new StdioClientTransport({
      command: PYTHON_BIN,
      args: [path.join(PROJECT_ROOT, 'mcp-server', 'server.py')],
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        PROJECT_ROOT,
      },
    });
    const client = new Client({ name: 'local-coding-ai-agent-relay', version: '0.1.0' });
    await client.connect(mcpTransport);
    mcpClient = client;
    return client;
  })();
  try { return await connecting; } finally { connecting = undefined; }
}

function authorized(req) {
  const value = req.headers.authorization || '';
  return value === `Bearer ${RELAY_TOKEN}`;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': 'chrome-extension://*',
    'Access-Control-Allow-Headers': 'content-type, authorization',
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function handleAction(req, res) {
  if (!authorized(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  let payload;
  try { payload = JSON.parse(await readBody(req)); }
  catch (err) { return sendJson(res, 400, { ok: false, error: String(err.message || err) }); }

  if (payload?.type !== 'action' || typeof payload.tool !== 'string' || typeof payload.arguments !== 'object') {
    return sendJson(res, 400, { ok: false, error: 'invalid action envelope' });
  }
  if (!ALLOWED_TOOLS.has(payload.tool)) {
    return sendJson(res, 403, { ok: false, error: `tool not allowed: ${payload.tool}` });
  }

  try {
    const client = await getMcpClient();
    const result = await client.callTool({ name: payload.tool, arguments: payload.arguments });
    const content = (result.content || []).map((item) => item?.type === 'text' ? item.text : JSON.stringify(item));
    return sendJson(res, 200, {
      type: 'result',
      request_id: payload.request_id ?? null,
      ok: !result.isError,
      result: content.join('\n'),
    });
  } catch (err) {
    return sendJson(res, 500, {
      type: 'result', request_id: payload.request_id ?? null,
      ok: false, error: String(err?.stack || err),
    });
  }
}

async function main() {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'content-type, authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
      return res.end();
    }
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { ok: true, service: 'local-coding-ai-agent-relay', project_root: PROJECT_ROOT });
    }
    if (req.method === 'GET' && req.url === '/token-info') {
      return authorized(req)
        ? sendJson(res, 200, { ok: true })
        : sendJson(res, 401, { ok: false, error: 'unauthorized' });
    }
    if (req.method === 'POST' && req.url === '/action') return handleAction(req, res);
    return sendJson(res, 404, { ok: false, error: 'not found' });
  });

  server.listen(PORT, HOST, () => {
    console.error(`Local Coding AI relay listening on http://${HOST}:${PORT}`);
    console.error(`PROJECT_ROOT=${PROJECT_ROOT}`);
    console.error(`MCP_PYTHON=${PYTHON_BIN}`);
    console.error(`Relay token file: ${TOKEN_FILE}`);
  });

  const shutdown = async () => {
    try { await mcpClient?.close(); } catch {}
    try { await mcpTransport?.close(); } catch {}
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => { console.error(err); process.exit(1); });
