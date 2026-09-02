const $ = (id) => document.getElementById(id);

async function load() {
  const config = await chrome.runtime.sendMessage({ type: 'get-config' });
  $('relay').value = config.relayUrl || 'http://127.0.0.1:8787';
  $('token').value = config.token || '';
}

$('save').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({
    type: 'set-config',
    relayUrl: $('relay').value.trim(),
    token: $('token').value.trim(),
  });
  $('status').textContent = 'Configuration saved.';
});

$('test').addEventListener('click', async () => {
  $('status').textContent = 'Testing...';
  try {
    const response = await fetch(`${$('relay').value.trim() || 'http://127.0.0.1:8787'}/health`, {
      headers: $('token').value.trim() ? { Authorization: `Bearer ${$('token').value.trim()}` } : {},
    });
    const data = await response.json();
    $('status').textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    $('status').textContent = `Relay test failed: ${error.message || error}`;
  }
});

$('start').addEventListener('click', async () => {
  const saved = await chrome.runtime.sendMessage({
    type: 'set-config',
    relayUrl: $('relay').value.trim(),
    token: $('token').value.trim(),
  });
  if (!saved?.ok) {
    $('status').textContent = 'Could not save configuration.';
    return;
  }
  const result = await chrome.runtime.sendMessage({ type: 'start-agent-mode' });
  $('status').textContent = result?.ok ? 'Agent mode started in the active ChatGPT tab.' : `Failed: ${result?.error || 'unknown error'}`;
});

load();
