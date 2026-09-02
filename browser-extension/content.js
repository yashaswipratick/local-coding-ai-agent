const RESULT_PREFIX = 'LOCAL_AGENT_RESULT';
const BOOTSTRAP = `LOCAL CODING AGENT MODE IS ON.
The browser extension is the local controller. ChatGPT is the reasoning layer.
For local-project questions, rely on LOCAL_AGENT_RESULT supplied by the controller. Do not use GitHub, web search, browsing, connected apps, remote repositories, or conversation files to infer local state. Do not claim to have inspected the local machine unless the controller result says so.
You may explain, reason, plan, and write code based on the supplied local result.`;

let enabled = false;
let controllerBusy = false;
let agentSubmitting = false;
let lastHandledText = '';

function composer() {
  return document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');
}

function composerText() {
  const el = composer();
  return el?.value ?? el?.textContent ?? '';
}

function setText(text) {
  const el = composer();
  if (!el) throw new Error('ChatGPT composer not found');
  el.focus();
  if (el.tagName === 'TEXTAREA') {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, text);
  } else {
    el.textContent = text;
  }
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
}

function submit() {
  const button = [...document.querySelectorAll('button')].find((b) => {
    const label = `${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`.toLowerCase();
    return (label.includes('send') || label.includes('submit')) && !b.disabled;
  });
  if (button) { button.click(); return true; }
  composer()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  return true;
}

function executeLocal(tool, args) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: 'execute-action',
      envelope: {
        type: 'action',
        request_id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        tool,
        arguments: args,
      },
    }, (response) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(response);
    });
  });
}

function classify(text) {
  const value = text.trim();
  const lower = value.toLowerCase();
  if (!value) return null;

  if (/\bgit\s+status\b/.test(lower)) return { tool: 'git_status', args: {} };
  if (/\bgit\s+diff\b/.test(lower)) return { tool: 'git_diff', args: {} };

  const read = value.match(/\b(?:read|open|inspect|show|cat)\s+(?:the\s+)?(?:file\s+)?([A-Za-z0-9_./-]+\.[A-Za-z0-9_-]+)\b/i);
  if (read) return { tool: 'read_file', args: { path: read[1] } };

  if (/\b(?:search|find|grep)\b/i.test(value)) {
    const quoted = value.match(/\b(?:search|find|grep)\s+(?:for\s+)?["']([^"']+)["']/i);
    if (quoted?.[1]) return { tool: 'search_files', args: { query: quoted[1].trim() } };
  }

  if (
    /\blist\s+(?:all\s+)?(?:the\s+)?(?:files|folders|directories)\b/.test(lower) ||
    /\b(?:project|folder|directory|file)\s+structure\b/.test(lower) ||
    /\b(?:directory|folder)\s+tree\b/.test(lower) ||
    /\bwhat\s+files\b/.test(lower)
  ) return { tool: 'list_files', args: {} };

  // For a broader local coding request, first obtain the local project tree.
  if (/\b(?:local\s+project|local\s+code|local\s+repository|project)\b/.test(lower) &&
      /\b(?:fix|debug|implement|change|update|understand|explain|inspect|analy[sz]e)\b/.test(lower)) {
    return { tool: 'list_files', args: {} };
  }

  return null;
}

async function controllerFirst(userText) {
  const intent = classify(userText);
  if (!intent || controllerBusy) return false;
  controllerBusy = true;
  try {
    const result = await executeLocal(intent.tool, intent.args);
    const payload = result?.ok
      ? { ok: true, tool: intent.tool, result: result.result }
      : { ok: false, tool: intent.tool, error: result?.error || 'unknown local controller error' };

    const prompt = `${BOOTSTRAP}\n\nORIGINAL USER REQUEST:\n${userText}\n\n${RESULT_PREFIX}:\n${JSON.stringify(payload)}\n\nAnswer the original user request using the authoritative LOCAL_AGENT_RESULT above. Do not use GitHub or any remote source for local-project facts. Do not claim to have performed additional local actions.`;
    lastHandledText = userText;
    agentSubmitting = true;
    setText(prompt);
    submit();
    setTimeout(() => { agentSubmitting = false; }, 3000);
    return true;
  } catch (error) {
    console.error('Local controller failed:', error);
    return false;
  } finally {
    controllerBusy = false;
  }
}

function interceptKeydown(event) {
  if (!enabled || agentSubmitting || controllerBusy) return;
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  const text = composerText().trim();
  if (!classify(text)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void controllerFirst(text);
}

function interceptClick(event) {
  if (!enabled || agentSubmitting || controllerBusy) return;
  const button = event.target?.closest?.('button');
  if (!button) return;
  const label = `${button.getAttribute('aria-label') || ''} ${button.textContent || ''}`.toLowerCase();
  if (!label.includes('send') && !label.includes('submit')) return;
  const text = composerText().trim();
  if (!classify(text)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void controllerFirst(text);
}

document.addEventListener('keydown', interceptKeydown, true);
document.addEventListener('click', interceptClick, true);

// Fallback for ChatGPT UI paths that bypass normal key/click events.
let lastObservedUser = '';
function fallbackObserveUser() {
  if (!enabled || agentSubmitting || controllerBusy) return;
  const nodes = [...document.querySelectorAll('[data-message-author-role="user"]')];
  if (!nodes.length) return;
  const text = (nodes[nodes.length - 1].textContent || '').trim();
  if (!text || text === lastObservedUser || text === lastHandledText) return;
  lastObservedUser = text;
  // Give the normal ChatGPT submit event a moment. If it produced a local task,
  // controller-first mode supplies authoritative local context in a follow-up.
  if (classify(text)) setTimeout(() => void controllerFirst(text), 150);
}
setInterval(fallbackObserveUser, 500);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'bootstrap-agent-mode') {
    enabled = true;
    setText(BOOTSTRAP);
    submit();
    sendResponse({ ok: true });
    return true;
  }
});
