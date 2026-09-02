const COMMAND_START = '[[LOCAL_AGENT_COMMAND]]';
const COMMAND_END = '[[/LOCAL_AGENT_COMMAND]]';
const RESULT_PREFIX = 'LOCAL_AGENT_RESULT';

const BOOTSTRAP = `You are the reasoning engine for a LOCAL CODING AGENT. This is a text protocol, not a native ChatGPT tool.

For any request that needs the user's local project, ALWAYS request data through LOCAL_AGENT_COMMAND. Never use GitHub, web, browsing, connected apps, remote repositories, or conversation files for local-project inspection. Do not answer from assumptions or prior project knowledge. Never say that a local tool is unavailable.

Emit exactly one command at a time and wait for LOCAL_AGENT_RESULT before continuing:
${COMMAND_START}
{"type":"action","request_id":"unique-id","tool":"tool_name","arguments":{}}
${COMMAND_END}

Supported commands:
- list_files({path?: string})
- read_file({path: string})
- search_files({query: string})
- git_status({})
- git_diff({})

Use relative paths only. Treat LOCAL_AGENT_RESULT as authoritative local state. For a file-list request, immediately emit list_files instead of explaining tool availability.

When complete:
${COMMAND_START}
{"type":"done","summary":"..."}
${COMMAND_END}`;

const RECOVERY = `LOCAL AGENT PROTOCOL RECOVERY. Do not discuss tool availability. Do not use GitHub, web, browsing, connected apps, or remote repositories. Emit exactly one LOCAL_AGENT_COMMAND for the pending local-project request, then wait for LOCAL_AGENT_RESULT.`;

let enabled = false;
const seen = new WeakSet();
const recoverySent = new WeakSet();

function getComposer() { return document.querySelector('textarea') || document.querySelector('[contenteditable="true"]'); }

function setComposerText(text) {
  const el = getComposer();
  if (!el) throw new Error('ChatGPT composer not found');
  el.focus();
  if (el.tagName === 'TEXTAREA') {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, text);
  } else {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.deleteContents();
    el.appendChild(document.createTextNode(text));
  }
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
}

function submitComposer() {
  const button = [...document.querySelectorAll('button')].find((b) => {
    const label = `${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`.toLowerCase();
    return (label.includes('send') || label.includes('submit')) && !b.disabled;
  });
  if (button) { button.click(); return true; }
  getComposer()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  return true;
}

function executeAction(envelope) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'execute-action', envelope }, (response) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(response);
    });
  });
}

function extractCommand(text) {
  const start = text.indexOf(COMMAND_START);
  if (start < 0) return null;
  const end = text.indexOf(COMMAND_END, start + COMMAND_START.length);
  if (end < 0) return null;
  try {
    const value = JSON.parse(text.slice(start + COMMAND_START.length, end).trim());
    if (!value || typeof value !== 'object') return null;
    return value.type === 'action' || value.type === 'done' ? value : null;
  } catch { return null; }
}

function looksLikeFailure(text) {
  const t = text.toLowerCase();
  return t.includes('local mcp') || t.includes('local coding ai agent') && (t.includes('not available') || t.includes('not exposed') || t.includes('cannot access'));
}

function assistantArticles() { return [...document.querySelectorAll('[data-message-author-role="assistant"]')].length ? [...document.querySelectorAll('[data-message-author-role="assistant"]')] : [...document.querySelectorAll('article')]; }

function sendRecovery(article) {
  if (recoverySent.has(article)) return;
  recoverySent.add(article);
  seen.add(article);
  setTimeout(() => { try { setComposerText(RECOVERY); submitComposer(); } catch (e) { console.error('Local agent recovery failed:', e); } }, 250);
}

async function processAssistantArticle(article) {
  if (seen.has(article)) return;
  const text = article.textContent || '';
  const command = extractCommand(text);
  if (!command) { if (looksLikeFailure(text)) sendRecovery(article); return; }
  seen.add(article);
  if (command.type === 'done') return;
  const result = await executeAction(command);
  const responseText = result?.ok ? `${RESULT_PREFIX}\n${JSON.stringify(result)}` : `LOCAL_AGENT_ERROR\n${JSON.stringify(result || { ok: false, error: 'unknown error' })}`;
  setComposerText(responseText);
  submitComposer();
}

function scan() { if (!enabled) return; for (const article of assistantArticles()) void processAssistantArticle(article); }
new MutationObserver(scan).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
setInterval(scan, 1000);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'bootstrap-agent-mode') { enabled = true; setComposerText(BOOTSTRAP); submitComposer(); sendResponse({ ok: true }); return true; }
});
