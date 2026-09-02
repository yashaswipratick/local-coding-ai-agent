const $ = (id) => document.getElementById(id);
const DEFAULT_RELAY_URL = 'http://127.0.0.1:8787';

async function refreshSessionState(showStatus = false) {
  const session = await chrome.runtime.sendMessage({ type: 'check-session' });
  if (session?.authenticated) {
    renderAccount(session.email || '');
    $('status').textContent = showStatus
      ? `Authenticated. Session expires in ${Math.max(1, Math.floor(session.expires_in_seconds / 60))} minutes.`
      : '';
    return session;
  }
  renderAccount('');
  if (showStatus) $('status').textContent = session?.reason === 'expired_session'
    ? 'Google session expired. Please sign in again.'
    : 'Not signed in.';
  return session;
}

async function load() {
  const config = await chrome.runtime.sendMessage({ type: 'get-config' });
  $('relay').value = config.relayUrl || DEFAULT_RELAY_URL;
  await refreshSessionState(false);
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
  $('status').textContent = 'Opening Google sign-in...';
  try {
    const started = await chrome.runtime.sendMessage({ type: 'start-auth' });
    if (!started?.ok) throw new Error(started?.error || 'Could not start sign-in');
    $('status').textContent = 'Google sign-in opened. Complete it in the new tab, then reopen this popup to continue.';
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
  $('status').textContent = 'Checking authenticated session...';
  try {
    const result = await refreshSessionState(true);
    if (!result?.authenticated) return;
  } catch (error) {
    $('status').textContent = `Session test failed: ${error.message || error}`;
  }
});

$('start').addEventListener('click', async () => {
  $('status').textContent = 'Checking authenticated session...';
  const session = await chrome.runtime.sendMessage({ type: 'check-session' });
  if (!session?.authenticated) {
    renderAccount('');
    $('status').textContent = session?.reason === 'expired_session'
      ? 'Your local Google session expired. Please sign in again.'
      : 'Please sign in with Google first.';
    return;
  }
  renderAccount(session.email || '');
  const result = await chrome.runtime.sendMessage({ type: 'start-agent-mode' });
  $('status').textContent = result?.ok ? 'Agent mode started in the active ChatGPT tab.' : `Failed: ${result?.error || 'unknown error'}`;
});

load();
