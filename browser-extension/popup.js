const $ = (id) => document.getElementById(id);
const DEFAULT_RELAY_URL = 'http://127.0.0.1:8787';

async function load() {
  const config = await chrome.runtime.sendMessage({ type: 'get-config' });
  $('relay').value = config.relayUrl || DEFAULT_RELAY_URL;
  renderAccount(config.email || '');
}

function renderAccount(email) {
  if (email) {
    $('account').hidden = false;
    $('account').textContent = `Signed in as ${email}`;
  } else {
    $('account').hidden = true;
    $('account').textContent = '';
  }
}

$('signin').addEventListener('click', async () => {
  const relayUrl = $('relay').value.trim() || DEFAULT_RELAY_URL;
  $('status').textContent = 'Opening Google sign-in...';
  try {
    const started = await chrome.runtime.sendMessage({ type: 'start-auth' });
    if (!started?.ok) throw new Error(started?.error || 'Could not start sign-in');
    $('status').textContent = 'Complete Google sign-in in the opened tab. Waiting for authentication...';

    for (let i = 0; i < 60; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const result = await chrome.runtime.sendMessage({ type: 'poll-auth', state: started.state });
      if (result?.status === 'authenticated') {
        renderAccount(result.email);
        $('status').textContent = 'Signed in successfully. Session expires after 30 minutes.';
        return;
      }
      if (result?.status === 'error') throw new Error(result.error || 'Google sign-in failed');
    }
    throw new Error('Sign-in timed out. Start sign-in again.');
  } catch (error) {
    $('status').textContent = `Sign-in failed: ${error.message || error}`;
  }
});

$('logout').addEventListener('click', async () => {
  $('status').textContent = 'Signing out...';
  const result = await chrome.runtime.sendMessage({ type: 'logout' });
  renderAccount('');
  $('status').textContent = result?.ok ? 'Signed out. Local session revoked.' : `Sign-out failed: ${result?.error || 'unknown error'}`;
});

$('test').addEventListener('click', async () => {
  $('status').textContent = 'Testing...';
  try {
    const response = await fetch(`${$('relay').value.trim() || DEFAULT_RELAY_URL}/health`);
    const data = await response.json();
    $('status').textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    $('status').textContent = `Relay test failed: ${error.message || error}`;
  }
});

$('start').addEventListener('click', async () => {
  const config = await chrome.runtime.sendMessage({ type: 'get-config' });
  if (!config?.sessionToken) {
    $('status').textContent = 'Please sign in with Google first.';
    return;
  }
  const result = await chrome.runtime.sendMessage({ type: 'start-agent-mode' });
  $('status').textContent = result?.ok ? 'Agent mode started in the active ChatGPT tab.' : `Failed: ${result?.error || 'unknown error'}`;
});

load();
