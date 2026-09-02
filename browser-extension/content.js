const ACTION_START = '[[LOCAL_CODING_AGENT_ACTION]]';
const ACTION_END = '[[/LOCAL_CODING_AGENT_ACTION]]';
const TOOL_CONTRACT = `Available local tools and arguments:
- list_files({path?: string})
- read_file({path: string})
- search_files({query: string})
- write_file({path: string, content: string})
- apply_patch({path: string, old_text: string, new_text: string})
- run_command({command: string, timeout_seconds?: number})
- git_status({})
- git_diff({})`;
const BOOTSTRAP = `You are now operating in LOCAL CODING AGENT MODE.
You are the reasoning brain. A local executor on the user's Mac performs tool actions.
For any local-project action, output exactly one JSON envelope wrapped between these markers:
${ACTION_START}
{"type":"action","request_id":"unique-id","tool":"tool_name","arguments":{}}
${ACTION_END}
Do not put prose inside the markers and do not issue more than one action at a time.
When the task is complete, output:
${ACTION_START}
{"type":"done","summary":"..."}
${ACTION_END}
${TOOL_CONTRACT}
Never invent a tool. Never request absolute paths. Prefer the smallest safe change. Treat tool results as authoritative local state.`;

let enabled = false;
const seen = new WeakSet();

function getComposer() {
  return document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');
}

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
  const el = getComposer();
  el?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
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

function extractEnvelope(text) {
  const start = text.indexOf(ACTION_START);
  if (start < 0) return null;
  const end = text.indexOf(ACTION_END, start + ACTION_START.length);
  if (end < 0) return null;
  const candidate = text.slice(start + ACTION_START.length, end).trim();
  try {
    const value = JSON.parse(candidate);
    if (!value || typeof value !== 'object') return null;
    if (value.type !== 'action' && value.type !== 'done') return null;
    return value;
  } catch { return null; }
}

function assistantArticles() {
  const direct = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  if (direct.length) return direct;
  return [...document.querySelectorAll('article')].filter((article) => (article.textContent || '').includes(ACTION_START));
}

async function processAssistantArticle(article) {
  if (seen.has(article)) return;
  const envelope = extractEnvelope(article.textContent || '');
  if (!envelope) return;
  seen.add(article);
  if (envelope.type === 'done') return;

  const result = await executeAction(envelope);
  const responseText = result?.ok
    ? `LOCAL CODING AGENT TOOL RESULT\n${JSON.stringify(result)}`
    : `LOCAL CODING AGENT TOOL ERROR\n${JSON.stringify(result || { ok: false, error: 'unknown error' })}`;
  setComposerText(responseText);
  submitComposer();
}

function scan() {
  if (!enabled) return;
  for (const article of assistantArticles()) void processAssistantArticle(article);
}

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
setInterval(scan, 1500);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'bootstrap-agent-mode') {
    enabled = true;
    setComposerText(BOOTSTRAP);
    submitComposer();
    sendResponse({ ok: true });
    return true;
  }
});
