const ACTION_START = '[[LOCAL_CODING_AGENT_ACTION]]';
const ACTION_END = '[[/LOCAL_CODING_AGENT_ACTION]]';
const BOOTSTRAP = `You are now operating in LOCAL CODING AGENT MODE.
You are the reasoning brain. A local executor on the user's Mac performs tool actions.
For any action on the local project, output exactly one action envelope wrapped between these markers:
${ACTION_START}
{"type":"action","request_id":"unique-id","tool":"tool_name","arguments":{}}
${ACTION_END}
Do not put prose inside the markers and do not issue more than one action at a time.
When the task is complete, output:
${ACTION_START}
{"type":"done","summary":"..."}
${ACTION_END}
Available tools will be described by the local agent. Never invent a tool. Never request absolute paths. Prefer the smallest safe change.`;

let enabled = false;
const seen = new WeakSet();

function getComposer() {
  return document.querySelector('textarea')
    || document.querySelector('[contenteditable="true"]');
}

function setComposerText(text) {
  const el = getComposer();
  if (!el) throw new Error('ChatGPT composer not found');
  el.focus();
  if (el.tagName === 'TEXTAREA') {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, text);
  } else {
    el.textContent = text;
  }
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  return el;
}

function submitComposer() {
  const buttons = [...document.querySelectorAll('button')];
  const button = buttons.find((b) => {
    const label = `${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`.toLowerCase();
    return label.includes('send') || label.includes('submit');
  });
  if (button && !button.disabled) {
    button.click();
    return true;
  }
  const el = getComposer();
  el?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  return true;
}

async function getConfig() {
  return chrome.runtime.sendMessage({ type: 'get-config' });
}

async function executeAction(envelope) {
  const config = await getConfig();
  if (!config?.token) throw new Error('Relay token is not configured. Open the extension popup and set it.');
  const response = await fetch(`${config.relayUrl || 'http://127.0.0.1:8787'}/action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.token}`,
    },
    body: JSON.stringify(envelope),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `relay HTTP ${response.status}`);
  return data;
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
  } catch {
    return null;
  }
}

function assistantArticles() {
  const direct = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  if (direct.length) return direct;
  return [...document.querySelectorAll('article')].filter((article) => {
    const text = article.textContent || '';
    return text.includes(ACTION_START);
  });
}

async function processAssistantArticle(article) {
  if (seen.has(article)) return;
  const text = article.textContent || '';
  const envelope = extractEnvelope(text);
  if (!envelope) return;
  seen.add(article);

  if (envelope.type === 'done') return;

  try {
    const result = await executeAction(envelope);
    const responseText = `LOCAL CODING AGENT TOOL RESULT\n${JSON.stringify(result)}`;
    setComposerText(responseText);
    submitComposer();
  } catch (error) {
    const responseText = `LOCAL CODING AGENT TOOL ERROR\n${JSON.stringify({ ok: false, error: String(error.message || error) })}`;
    setComposerText(responseText);
    submitComposer();
  }
}

function scan() {
  if (!enabled) return;
  for (const article of assistantArticles()) void processAssistantArticle(article);
}

const observer = new MutationObserver(() => scan());
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
