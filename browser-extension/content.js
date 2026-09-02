const ACTION_START = '[[LOCAL_CODING_AGENT_ACTION]]';
const ACTION_END = '[[/LOCAL_CODING_AGENT_ACTION]]';
const TOOL_CONTRACT = `Available local read-only tools and arguments:
- list_files({path?: string})
- read_file({path: string})
- search_files({query: string})
- git_status({})
- git_diff({})
The extension executes these locally through a localhost relay. You do NOT have native MCP access in ChatGPT.
Write/patch/command execution tools are intentionally disabled in secure mode.`;
const BOOTSTRAP = `You are now operating in LOCAL CODING AI AGENT MODE.
You are the reasoning/controller layer for a local coding agent.
IMPORTANT: ChatGPT does NOT have a native Local Coding AI Agent MCP tool. Do not claim that a local tool is unavailable, and do not use GitHub/web/browsing/connected apps for local-project tasks.
Instead, communicate with the local executor using the text protocol below.
Whenever a request requires local project state, you MUST emit exactly one JSON action envelope between these markers and wait for the returned tool result before continuing:
${ACTION_START}
{"type":"action","request_id":"unique-id","tool":"tool_name","arguments":{}}
${ACTION_END}
Supported local tools:
${TOOL_CONTRACT}
After the extension returns a tool result, continue from that local result. If more local information is required, emit exactly one more action envelope. Do not emit more than one action at a time.
When the task is complete, output:
${ACTION_START}
{"type":"done","summary":"..."}
${ACTION_END}
Never invent a tool. Never request absolute paths. Prefer the smallest safe read. Treat tool results as authoritative local state. For a request like “list the files”, immediately emit list_files instead of explaining that a tool is unavailable.`;
const RECOVERY_PROMPT = `LOCAL CODING AGENT PROTOCOL RECOVERY.
You previously responded that a local MCP/tool was unavailable. Do not repeat that explanation.
You are not being asked to invoke a native ChatGPT tool. You are being asked to emit the LOCAL CODING AGENT text protocol so the browser extension can execute the action locally.
For the pending local-project request, emit exactly one action envelope now.
Use only these tools:
- list_files({path?: string})
- read_file({path: string})
- search_files({query: string})
- git_status({})
- git_diff({})
Do not use GitHub, web, browsing, connected apps, or remote repository data.`;

let enabled = false;
const seen = new WeakSet();
const recoverySent = new WeakSet();

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

function looksLikeToolUnavailable(text) {
  const normalized = text.toLowerCase();
  return (normalized.includes('local mcp') || normalized.includes('local coding ai agent')) && (
    normalized.includes('not available') ||
    normalized.includes('unavailable') ||
    normalized.includes('not exposed') ||
    normalized.includes('currently exposed') ||
    normalized.includes('tools currently exposed')
  );
}

function assistantArticles() {
  const direct = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  if (direct.length) return direct;
  return [...document.querySelectorAll('article')].filter((article) => {
    const text = article.textContent || '';
    return text.includes(ACTION_START) || looksLikeToolUnavailable(text);
  });
}

function sendRecovery(article) {
  if (recoverySent.has(article)) return;
  recoverySent.add(article);
  seen.add(article);
  setTimeout(() => {
    try {
      setComposerText(RECOVERY_PROMPT);
      submitComposer();
    } catch (error) {
      console.error('Local Coding AI Agent recovery failed:', error);
    }
  }, 250);
}

async function processAssistantArticle(article) {
  if (seen.has(article)) return;
  const text = article.textContent || '';
  const envelope = extractEnvelope(text);
  if (!envelope) {
    if (looksLikeToolUnavailable(text)) sendRecovery(article);
    return;
  }
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
