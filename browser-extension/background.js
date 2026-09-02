const DEFAULT_RELAY_URL = 'http://127.0.0.1:8787';

async function getConfig() {
  return chrome.storage.local.get({ relayUrl: DEFAULT_RELAY_URL, sessionToken: '', email: '' });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'get-config') {
    getConfig().then(sendResponse);
    return true;
  }

  if (message?.type === 'set-session') {
    chrome.storage.local.set({
      relayUrl: message.relayUrl || DEFAULT_RELAY_URL,
      sessionToken: message.sessionToken || '',
      email: message.email || '',
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === 'clear-session') {
    chrome.storage.local.set({ sessionToken: '', email: '' }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === 'execute-action') {
    getConfig().then(async ({ relayUrl, sessionToken }) => {
      if (!sessionToken) throw new Error('Not signed in. Open the extension and sign in with Google.');
      const response = await fetch(`${relayUrl || DEFAULT_RELAY_URL}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
        body: JSON.stringify(message.envelope),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) await chrome.storage.local.set({ sessionToken: '', email: '' });
        throw new Error(data.error || `relay HTTP ${response.status}`);
      }
      sendResponse(data);
    }).catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message?.type === 'start-auth') {
    getConfig().then(async ({ relayUrl }) => {
      const response = await fetch(`${relayUrl || DEFAULT_RELAY_URL}/auth/start`);
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not start Google sign-in');
      await chrome.tabs.create({ url: data.auth_url });
      sendResponse({ ok: true, state: data.state });
    }).catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message?.type === 'poll-auth') {
    getConfig().then(async ({ relayUrl }) => {
      const response = await fetch(`${relayUrl || DEFAULT_RELAY_URL}/auth/status?state=${encodeURIComponent(message.state)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `auth status HTTP ${response.status}`);
      if (data.status === 'authenticated') {
        await chrome.storage.local.set({ relayUrl: relayUrl || DEFAULT_RELAY_URL, sessionToken: data.session_token, email: data.email });
      }
      sendResponse(data);
    }).catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }

  if (message?.type === 'logout') {
    getConfig().then(async ({ relayUrl, sessionToken }) => {
      if (sessionToken) {
        await fetch(`${relayUrl || DEFAULT_RELAY_URL}/logout`, {
          method: 'POST', headers: { Authorization: `Bearer ${sessionToken}` },
        }).catch(() => {});
      }
      await chrome.storage.local.set({ sessionToken: '', email: '' });
      sendResponse({ ok: true });
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
