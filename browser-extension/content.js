const COMMAND_START = '[[LOCAL_AGENT_COMMAND]]';
const COMMAND_END = '[[/LOCAL_AGENT_COMMAND]]';
const RESULT_PREFIX = 'LOCAL_AGENT_RESULT';

const BOOTSTRAP = `You are the reasoning engine for a local coding agent. You do not have filesystem access yourself. Do not use GitHub, web, browsing, connected apps, remote repositories, or conversation files for local-project inspection.

For local-project tasks, cooperate with an external local controller. When the controller protocol is needed, output exactly one JSON command between these markers:
${COMMAND_START}
{"type":"action","request_id":"unique-id","tool":"tool_name","arguments":{}}
${COMMAND_END}

Supported tools: list_files({path?: string}), read_file({path: string}), search_files({query: string}), git_status({}), git_diff({}). Use relative paths only. Do not claim that you inspected the local filesystem. Wait for LOCAL_AGENT_RESULT before making claims about local state.

When complete, emit a done envelope using the same markers.`;

let enabled = false;
const seen = new WeakSet();
const routedRefusal = new WeakSet();

function composer() { return document.querySelector('textarea') || document.querySelector('[contenteditable="true"]'); }
function setText(text) {
  const el = composer(); if (!el) throw new Error('ChatGPT composer not found'); el.focus();
  if (el.tagName === 'TEXTAREA') {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, text);
  } else {
    el.textContent = text;
  }
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
}
function submit() {
  const btn = [...document.querySelectorAll('button')].find(b => {
    const s = `${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`.toLowerCase();
    return (s.includes('send') || s.includes('submit')) && !b.disabled;
  });
  if (btn) { btn.click(); return; }
  composer()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
}
function extract(text) {
  const s = text.indexOf(COMMAND_START); if (s < 0) return null;
  const e = text.indexOf(COMMAND_END, s + COMMAND_START.length); if (e < 0) return null;
  try {
    const v = JSON.parse(text.slice(s + COMMAND_START.length, e).trim());
    return v && (v.type === 'action' || v.type === 'done') ? v : null;
  } catch { return null; }
}
function isLocalRefusal(text) {
  const t = text.toLowerCase();
  const mentionsLocal = t.includes('local machine') || t.includes('local project') || t.includes('local filesystem') || t.includes('local mcp') || t.includes('local coding ai agent');
  const refuses = t.includes("can't") || t.includes('cannot') || t.includes('do not have') || t.includes('not available') || t.includes('not exposed') || t.includes('no direct access') || t.includes('don\'t have access');
  return mentionsLocal && refuses;
}
function latestUserText() {
  const nodes = [...document.querySelectorAll('[data-message-author-role="user"]')];
  if (!nodes.length) return '';
  return nodes[nodes.length - 1].textContent || '';
}
function looksLikeListFilesTask(text) {
  const t = text.toLowerCase();
  return (t.includes('list the files') || t.includes('list files') || t.includes('project structure') || t.includes('file structure') || t.includes('directory structure'));
}
function executeLocal(envelope) {
  return new Promise(resolve => chrome.runtime.sendMessage({ type: 'execute-action', envelope }, r => resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r)));
}

async function routeSimpleRefusal(article) {
  if (routedRefusal.has(article)) return;
  routedRefusal.add(article);
  const userTask = latestUserText();
  if (!looksLikeListFilesTask(userTask)) return;

  const result = await executeLocal({
    type: 'action',
    request_id: `auto-list-${Date.now()}`,
    tool: 'list_files',
    arguments: { path: '.' },
  });

  const responseText = result?.ok
    ? `${RESULT_PREFIX}\n${JSON.stringify(result)}\n\nUse this LOCAL filesystem result as authoritative. Answer the user's request using only this result. Do not use GitHub or any remote repository.`
    : `LOCAL_AGENT_ERROR\n${JSON.stringify(result || { ok: false, error: 'unknown error' })}`;
  setText(responseText);
  submit();
}

async function processArticle(article) {
  if (seen.has(article)) return;
  const text = article.textContent || '';
  const command = extract(text);
  if (!command) {
    if (isLocalRefusal(text)) await routeSimpleRefusal(article);
    return;
  }
  seen.add(article);
  if (command.type === 'done') return;
  const result = await executeLocal(command);
  const responseText = result?.ok
    ? `${RESULT_PREFIX}\n${JSON.stringify(result)}`
    : `LOCAL_AGENT_ERROR\n${JSON.stringify(result || { ok: false, error: 'unknown error' })}`;
  setText(responseText);
  submit();
}
function scan() {
  if (!enabled) return;
  const direct = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  const articles = direct.length ? direct : [...document.querySelectorAll('article')];
  for (const article of articles) void processArticle(article);
}
new MutationObserver(scan).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
setInterval(scan, 1000);
chrome.runtime.onMessage.addListener((m, _s, sendResponse) => {
  if (m?.type === 'bootstrap-agent-mode') {
    enabled = true;
    setText(BOOTSTRAP);
    submit();
    sendResponse({ ok: true });
    return true;
  }
});
