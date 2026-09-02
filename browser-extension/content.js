const ACTION_START = '[[LOCAL_CODING_AGENT_ACTION]]';
const ACTION_END = '[[/LOCAL_CODING_AGENT_ACTION]]';
const TOOL_CONTRACT = `Available local read-only tools and arguments:
- list_files({path?: string})
- read_file({path: string})
- search_files({query: string})
- git_status({})
- git_diff({})
Write/patch/command execution tools are intentionally disabled in secure mode.`;
const BOOTSTRAP = `You are now operating in STRICT LOCAL CODING AGENT MODE.
You are the reasoning brain for a local coding agent running on the user's Mac.

CRITICAL LOCAL-ONLY RULES:
1. NEVER use GitHub, web search, browsing, connected apps, repositories, remote files, or any other external connector to inspect the user's project.
2. NEVER infer or invent the local project structure from GitHub or previous conversation context.
3. For ANY request involving the local project, files, source code, Git status/diff, or repository contents, you MUST first issue exactly one local tool action using the action markers below.
4. Do NOT provide a normal answer to a local-project request until you have received a LOCAL CODING AGENT TOOL RESULT.
5. Treat the local tool result as the ONLY authoritative source for the local filesystem state.
6. If a local tool is needed, output the action envelope and nothing else.
7. Do not put prose inside the markers and do not issue more than one action at a time.

For any local-project read action, output exactly one JSON envelope wrapped between these markers:
${ACTION_START}
{"type":"action","request_id":"unique-id","tool":"tool_name","arguments":{}}
${ACTION_END}

When the task is complete, output:
${ACTION_START}
{"type":"done","summary":"..."}
${ACTION_END}

${TOOL_CONTRACT}
Never invent a tool. Never request absolute paths. Prefer the smallest safe read.
If you are asked to list files, inspect the filesystem with list_files rather than GitHub.
If you are asked to read code, inspect the filesystem with read_file rather than GitHub.
If you are asked about Git state, use git_status or git_diff locally rather than GitHub.
Do not mention a GitHub repository name, branch, or remote state unless that information came from a LOCAL CODING AGENT TOOL RESULT.`;

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
