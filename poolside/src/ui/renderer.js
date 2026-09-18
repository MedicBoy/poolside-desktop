const $ = selector => document.querySelector(selector);
let state = { accounts: [], events: [], settings: { table: 'Bangkok', limit: 10 } };
let toastTimer;
function screenRow(a) {
  const screen = a.gameScreen;
  const names = {
    inspecting: 'Inspecting game…',
    unknown: 'Screen not recognized',
    loading: 'Loading screen',
    connecting: 'Connecting screen',
    lobby: 'Lobby visible',
    'table-selection': 'Table selector visible',
    'lucky-promotion': 'Lucky Shot promotion',
    'lucky-shot': 'Lucky Shot'
  };
  const label = screen
    ? `${names[screen.state] || names.unknown}${typeof screen.score === 'number' && screen.score > 0 ? ' · ' + Math.round(screen.score * 100) + '%' : ''}${screen.observedAt ? ' · ' + new Date(screen.observedAt).toLocaleTimeString() : ''}`
    : 'Game screen not inspected';
  return `<div class="network-row"><span>${escapeHtml(label)}</span><button class="text-button" data-action="inspect" data-id="${a.id}" title="Read a single game image locally; this does not verify responsiveness" ${a.status === 'closed' || a.status === 'loading' || screen?.state === 'inspecting' ? 'disabled' : ''}>Inspect game ↗</button></div>`;
}
function networkRow(a) {
  const n = a.network;
  const label =
    n?.status === 'checked'
      ? `Public IPv4: ${n.ip} · ${new Date(n.checkedAt).toLocaleTimeString()}`
      : n?.status === 'checking'
        ? 'Checking public IPv4…'
        : n?.status === 'error'
          ? 'IP check failed · retry available'
          : 'Public IPv4 not checked';
  return `<div class="network-row"><span>${escapeHtml(label)}</span><button class="text-button" data-action="check-ip" data-id="${a.id}" title="Contact api.ipify.org using this account session" ${a.status === 'closed' || n?.status === 'checking' ? 'disabled' : ''}>Check IP ↗</button></div>`;
}
const escapeHtml = value =>
  String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function toast(message, error = false) {
  $('#toast').textContent = message;
  $('#toast').className = `toast${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.add('hidden'), 5500);
}
async function call(fn) {
  try {
    const result = await fn();
    if (!result.ok) throw new Error(result.error);
    if (result.value?.accounts) render(result.value);
    return result;
  } catch (error) {
    toast(error.message, true);
    return { ok: false, error: error.message };
  }
}
function view(name) {
  if (!['sessions', 'activity', 'settings'].includes(name)) return;
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('hidden', el.id !== `view-${name}`));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === name));
  $('#breadcrumb').textContent = name[0].toUpperCase() + name.slice(1);
}
function openDialog() {
  $('#account-form').reset();
  $('#account-error').textContent = '';
  const hasReceiver = state.accounts.some(a => a.role === 'receiver');
  $('#account-role').value = hasReceiver ? 'sender' : 'receiver';
  $('#account-role option[value="receiver"]').disabled = hasReceiver;
  $('#account-dialog').showModal();
  $('#account-name').focus();
}
function renderAccounts() {
  const query = $('#search').value.toLowerCase().trim();
  const accounts = state.accounts.filter(a => a.name.toLowerCase().includes(query));
  if (!state.accounts.length) {
    $('#accounts').innerHTML =
      '<div class="empty"><div class="empty-icon">＋</div><h3>Your first session starts here</h3><p>Add a receiving account to begin setting up your workspace.</p><button class="text-button add-account">Add your first account ↗</button></div>';
    return;
  }
  if (!accounts.length) {
    $('#accounts').innerHTML = '<div class="empty"><h3>No matching accounts</h3><p>Try a different name or clear your search.</p></div>';
    return;
  }
  $('#accounts').innerHTML = accounts
    .map(
      a =>
        `<article class="account-card"><span class="account-avatar ${a.role}">${escapeHtml(a.name[0].toUpperCase())}</span><div><div class="account-name">${escapeHtml(a.name)}</div><span class="account-role">${a.role === 'receiver' ? 'Receiving account' : 'Sending account'}</span></div><div class="account-actions"><button class="secondary" data-action="${a.status === 'closed' ? 'open' : 'focus'}" data-id="${a.id}">${a.status === 'closed' ? 'Open ↗' : 'Focus ↗'}</button>${a.status !== 'closed' ? `<button class="icon-button" aria-label="Close ${escapeHtml(a.name)} window" data-action="close" data-id="${a.id}">×</button>` : ''}</div><div class="account-bottom"><span class="status ${a.status}">${{ closed: '○ Window closed', loading: '◌ Loading game…', open: '● Window open · login unverified', error: '△ Page failed to load' }[a.status]}</span><button class="archive" data-action="archive" data-id="${a.id}" ${a.status !== 'closed' ? 'disabled' : ''}>Archive</button></div>${networkRow(a)}${screenRow(a)}<div class="network-row"><span>Shop opened after sign-in?</span><button class="text-button" data-action="return-game" data-id="${a.id}" ${a.status === 'closed' || a.status === 'loading' ? 'disabled' : ''}>Return to game ↗</button></div></article>`
    )
    .join('');
}
function eventRows(events) {
  return (
    events
      .map(
        e =>
          `<div class="event"><span class="event-mark ${e.kind}">${e.kind === 'warning' ? '△' : '•'}</span><span class="event-message">${escapeHtml(e.message)}</span><time datetime="${escapeHtml(e.at)}">${new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></div>`
      )
      .join('') || '<p class="muted">Activity will appear here as you use the workspace.</p>'
  );
}
function render(next) {
  state = next;
  const open = state.accounts.filter(a => a.status !== 'closed').length;
  $('#account-count').textContent = state.accounts.length;
  $('#open-count').textContent = open;
  $('#nav-count').textContent = state.accounts.length;
  $('#section-count').textContent = state.accounts.length;
  $('#window-hint').textContent = open ? 'Independent saved profiles' : 'Ready when you are';
  $('#receiver-name').textContent = state.accounts.find(a => a.role === 'receiver')?.name || 'Not selected';
  $('#sender-count').textContent = state.accounts.filter(a => a.role === 'sender').length;
  $('#table-value').textContent = state.settings.table;
  $('#limit-value').textContent = state.settings.limit;
  $('#open-all').disabled = !state.accounts.length;
  $('#close-all').disabled = !open;
  $('#arrange').disabled = !open;
  $('#recent-events').innerHTML = eventRows(state.events.slice(0, 3));
  $('#all-events').innerHTML = eventRows(state.events);
  renderAccounts();
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.view) view(button.dataset.view);
  if (button.classList.contains('add-account')) openDialog();
  if (button.dataset.action) {
    const { action, id } = button.dataset;
    await call(() =>
      action === 'inspect'
        ? poolside.inspect(id)
        : action === 'return-game'
          ? poolside.returnGame(id)
          : action === 'check-ip'
            ? poolside.checkIP(id)
            : action === 'archive'
              ? poolside.archive(id)
              : action === 'close'
                ? poolside.close(id)
                : poolside.open(id)
    );
  }
});
$('.brand').addEventListener('click', event => {
  event.preventDefault();
  view('sessions');
});
$('#cancel-dialog').addEventListener('click', () => $('#account-dialog').close());
$('#account-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  const result = await call(() => poolside.add({ name: $('#account-name').value, role: $('#account-role').value }));
  button.disabled = false;
  if (result.ok) $('#account-dialog').close();
  else $('#account-error').textContent = result.error;
});
$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  const result = await call(() => poolside.saveSettings({ table: $('#table').value, limit: Number($('#limit').value) }));
  if (result.ok) $('#settings-status').textContent = 'Preferences saved on this device.';
});
$('#open-all').addEventListener('click', () => call(() => poolside.openAll()));
$('#close-all').addEventListener('click', () => call(() => poolside.closeAll()));
$('#arrange').addEventListener('click', () => call(() => poolside.arrange()));
$('#search').addEventListener('input', renderAccounts);
poolside.subscribe(render);
call(() => poolside.get()).then(result => {
  if (result.ok) {
    $('#table').value = state.settings.table;
    $('#limit').value = state.settings.limit;
  }
});
