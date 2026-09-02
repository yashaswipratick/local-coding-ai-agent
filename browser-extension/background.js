const DEFAULT_RELAY_URL = 'http://127.0.0.1:8787';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'get-config') {
    chrome.storage.local.get({ relayUrl: DEFAULT_RELAY_URL, token: '' }).then(sendResponse);
    return true;
  }

  if (message?.type === 'set-config') {
    chrome.storage.local.set({
      relayUrl: message.relayUrl || DEFAULT_RELAY_URL,
      token: message.token || '',
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === 'start-agent-mode') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (!tab?.id) throw new Error('No active tab');
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'bootstrap-agent-mode' });
      sendResponse(response);
    }).catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }
});
