const DEFAULT_RELAY_URL = 'http://127.0.0.1:8787';

async function getConfig() {
  return chrome.storage.local.get({ relayUrl: DEFAULT_RELAY_URL, sessionToken: '', email: '' });
}

async function checkSession() {
  const { relayUrl, sessionToken } = await getConfig();
  if (!sessionToken) return { ok: false, authenticated: false, reason: 'missing_session' };
  const response = await fetch(`${relayUrl || DEFAULT_RELAY_URL}/session`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  const data = await response.json();
  if (response.status === 401) {
    await chrome.storage.local.set({ sessionToken: '', email: '' });
    return { ok: false, authenticated: false, reason: 'expired_session' };
  }
  if (!response.ok) return { ok: false, authenticated: false, reason: data.error || `relay HTTP ${response.status}` };
  return data;
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

  if (message?.type === 'check-session') {
    checkSession()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, authenticated: false, reason: String(error.message || error) }));
    return true;
  }

  if (message?.type === 'execute-action') {
    getConfig().then(async ({ relayUrl, sessionToken }) => {
      if (!sessionToken) throw new Error('No local agent session. Sign in with Google in the extension first.');
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
    checkSession().then(async (session) => {
      if (!session?.authenticated) {
        const message = session?.reason === 'expired_session'
          ? 'Your local Google session expired. Please sign in again.'
          : 'No authenticated local session. Please sign in with Google in the extension first.';
        sendResponse({ ok: false, error: message });
        return;
      }
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab?.id) throw new Error('No active tab');
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'bootstrap-agent-mode' });
      sendResponse(response);
    }).catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }
});
