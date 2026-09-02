const COMMAND_START = '[[LOCAL_AGENT_COMMAND]]';
const COMMAND_END = '[[/LOCAL_AGENT_COMMAND]]';
const RESULT_PREFIX = 'LOCAL_AGENT_RESULT';

const BOOTSTRAP = `You are the reasoning engine for a local coding agent. You are not a tool executor and must not claim access to the user's Mac, GitHub, web, browsing, connected apps, or conversation files for local-project inspection. An external local controller executes structured commands on the user's Mac.

For every request that needs local project information, output exactly one command between these markers and then wait for LOCAL_AGENT_RESULT:
${COMMAND_START}
{"type":"action","request_id":"unique-id","tool":"list_files","arguments":{"path":"."}}
${COMMAND_END}

Supported tools: list_files({path?: string}), read_file({path: string}), search_files({query: string}), git_status({}), git_diff({}). Use relative paths only. Never use GitHub or remote repository data to answer local-project questions. Never say that the local controller is unavailable. Do not put prose inside the markers. When finished, emit a done envelope using the same markers.`;

const RECOVERY = `LOCAL AGENT CONTROLLER RECOVERY. You are a planner, not a tool executor. Do not discuss tool availability and do not use GitHub, web, browsing, connected apps, or remote repositories. Emit exactly one local command now using the required markers, then wait for LOCAL_AGENT_RESULT.
${COMMAND_START}
{"type":"action","request_id":"recovery-1","tool":"list_files","arguments":{"path":"."}}
${COMMAND_END}`;

let enabled = false;
const seen = new WeakSet();
const recoverySent = new WeakSet();

function composer() { return document.querySelector('textarea') || document.querySelector('[contenteditable="true"]'); }
function setText(text) {
  const el = composer(); if (!el) throw new Error('ChatGPT composer not found'); el.focus();
  if (el.tagName === 'TEXTAREA') { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; setter?.call(el, text); }
  else { el.textContent = text; }
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
}
function submit() {
  const btn = [...document.querySelectorAll('button')].find(b => { const s = `${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`.toLowerCase(); return (s.includes('send') || s.includes('submit')) && !b.disabled; });
  if (btn) { btn.click(); return; }
  composer()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
}
function extract(text) {
  const s = text.indexOf(COMMAND_START); if (s < 0) return null;
  const e = text.indexOf(COMMAND_END, s + COMMAND_START.length); if (e < 0) return null;
  try { const v = JSON.parse(text.slice(s + COMMAND_START.length, e).trim()); return v && (v.type === 'action' || v.type === 'done') ? v : null; } catch { return null; }
}
function isRefusal(text) {
  const t = text.toLowerCase();
  return (t.includes('local') && (t.includes('not available') || t.includes('not exposed') || t.includes('cannot access') || t.includes("can't access") || t.includes('no direct access')));
}
function execute(envelope) {
  return new Promise(resolve => chrome.runtime.sendMessage({ type: 'execute-action', envelope }, r => resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r)));
}
async function processArticle(article) {
  if (seen.has(article)) return;
  const text = article.textContent || '';
  const command = extract(text);
  if (!command) { if (isRefusal(text) && !recoverySent.has(article)) { recoverySent.add(article); seen.add(article); setTimeout(() => { try { setText(RECOVERY); submit(); } catch (e) { console.error(e); } }, 250); } return; }
  seen.add(article); if (command.type === 'done') return;
  const result = await execute(command);
  setText(`${RESULT_PREFIX}\n${JSON.stringify(result)}`); submit();
}
function scan() { if (!enabled) return; for (const a of document.querySelectorAll('[data-message-author-role="assistant"], article')) void processArticle(a); }
new MutationObserver(scan).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
setInterval(scan, 1000);
chrome.runtime.onMessage.addListener((m, _s, sendResponse) => { if (m?.type === 'bootstrap-agent-mode') { enabled = true; setText(BOOTSTRAP); submit(); sendResponse({ ok: true }); return true; } });
