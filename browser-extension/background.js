const DEFAULT_RELAY_URL = 'http://127.0.0.1:8787';

async function getConfig() {
  return chrome.storage.local.get({ relayUrl: DEFAULT_RELAY_URL, token: '' });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'get-config') {
    getConfig().then(sendResponse);
    return true;
  }

  if (message?.type === 'set-config') {
    chrome.storage.local.set({
      relayUrl: message.relayUrl || DEFAULT_RELAY_URL,
      token: message.token || '',
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === 'execute-action') {
    getConfig().then(async ({ relayUrl, token }) => {
      if (!token) throw new Error('Relay token is not configured');
      const response = await fetch(`${relayUrl || DEFAULT_RELAY_URL}/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(message.envelope),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `relay HTTP ${response.status}`);
      sendResponse(data);
    }).catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
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
