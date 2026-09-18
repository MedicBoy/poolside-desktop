const $ = selector => document.querySelector(selector);
let state = { accounts: [], events: [], settings: { table: 'Bangkok', limit: 10 } };
let toastTimer;
// Session states come from the FSM (src/session-fsm.cjs). `closed` is what a session with no open
// window reports, so it appears here even though nothing stores it as a state.
const CLOSED_STATUSES = ['idle', 'closed'];
const BUSY_STATUSES = ['launching', 'loading', 'closing'];
const STATUS_LABELS = {
  idle: '○ Not started',
  closed: '○ Window closed',
  launching: '◌ Starting session…',
  loading: '◌ Loading game…',
  ready: '● Window open · login unverified',
  degraded: '△ Needs attention',
  closing: '○ Closing…'
};
const isClosed = account => CLOSED_STATUSES.includes(account.status);
const isBusy = account => BUSY_STATUSES.includes(account.status);
const statusLabel = account => STATUS_LABELS[account.status] || STATUS_LABELS.closed;
// A degraded session explains itself: what went wrong, how many recoveries were tried, and whether
// the automatic budget is spent (supervision.cjs owns that policy).
function healthRow(a) {
  if (a.status !== 'degraded') return '';
  const health = a.health || {};
  const attempts = health.attempts ? ` · ${health.attempts} recovery attempt${health.attempts === 1 ? '' : 's'}` : '';
  const next = health.nextAttemptAt ? ` · retrying ${new Date(health.nextAttemptAt).toLocaleTimeString()}` : '';
  const spent = health.exhausted ? ' · automatic recovery stopped; reopen the window to retry' : '';
  return `<div class="network-row"><span>${escapeHtml(`${a.statusReason || 'Session needs attention'}${attempts}${next}${spent}`)}</span></div>`;
}
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
  return `<div class="network-row"><span>${escapeHtml(label)}</span><button class="text-button" data-action="inspect" data-id="${a.id}" title="Read a single game image locally; this does not verify responsiveness" ${isClosed(a) || isBusy(a) || screen?.state === 'inspecting' ? 'disabled' : ''}>Inspect game ↗</button></div>`;
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
  return `<div class="network-row"><span>${escapeHtml(label)}</span><button class="text-button" data-action="check-ip" data-id="${a.id}" title="Contact api.ipify.org using this account session" ${isClosed(a) || n?.status === 'checking' ? 'disabled' : ''}>Check IP ↗</button></div>`;
}
// The configured footprint, and — separately — what Chromium says it will actually use. They are shown
// apart on purpose: a configured route that is not in use is the failure this row exists to surface.
function footprintRow(a) {
  const f = a.footprint;
  if (!f) return '';
  const parts = [];
  if (f.summary && f.summary !== 'not configured') parts.push(f.summary);
  if (f.route && f.route.configured) parts.push(`route: ${f.route.label}`);
  if (f.verified && f.verified.ok)
    parts.push(f.verified.matches ? `using ${f.verified.route.label}` : `NOT using the configured route (${f.verified.route.label})`);
  if (f.storage && f.storage.cacheBytes !== null)
    parts.push(`${Math.round(f.storage.cacheBytes / 1024)} KB cached${f.storage.overQuota ? ', over the configured ceiling' : ''}`);
  const text = parts.length ? parts.join(' · ') : 'default footprint — no identity or route configured';
  return `<div class="network-row"><span>${escapeHtml(text)}</span><button class="text-button" data-action="check-route" data-id="${a.id}" title="Ask Chromium which route this session will actually use" ${isClosed(a) ? 'disabled' : ''}>Check route ↗</button></div>`;
}
const formatBytes = value => {
  const n = Math.max(0, Number(value) || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};
// The profile on disk: which generation of storage this is, what it occupies, whether it is over its
// ceiling, and whether damage has ever had to be repaired in it. Deletion is refused while the session is
// open, so the control is disabled and says why rather than failing when pressed.
function profileRow(a) {
  const p = a.profile;
  if (!p) return '';
  const parts = [];
  if (Number.isInteger(p.generation)) parts.push(`storage generation ${p.generation}`);
  if (Number.isInteger(p.directoryBytes)) parts.push(`${formatBytes(p.directoryBytes)} on disk${p.truncated ? ' or more' : ''}`);
  if (p.quotaBytes) parts.push(`ceiling ${formatBytes(p.quotaBytes)}${p.overQuota ? ' exceeded' : ''}`);
  if (p.corruption && p.corruption.count) {
    parts.push(`${p.corruption.count} damaged saved session${p.corruption.count === 1 ? '' : 's'} quarantined`);
  }
  const text = parts.length ? parts.join(' · ') : 'profile not measured yet';
  const title = isClosed(a) ? "Remove this account's cookies, site storage and saved session from this PC" : 'Close this session first';
  return `<div class="network-row"><span>${escapeHtml(text)}</span><button class="text-button" data-action="delete-profile" data-id="${a.id}" title="${title}" ${isClosed(a) ? '' : 'disabled'}>Delete profile…</button></div>`;
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
        `<article class="account-card"><span class="account-avatar ${a.role}">${escapeHtml(a.name[0].toUpperCase())}</span><div><div class="account-name">${escapeHtml(a.name)}</div><span class="account-role">${a.role === 'receiver' ? 'Receiving account' : 'Sending account'}</span></div><div class="account-actions"><button class="secondary" data-action="${isClosed(a) ? 'open' : 'focus'}" data-id="${a.id}">${isClosed(a) ? 'Open ↗' : 'Focus ↗'}</button>${!isClosed(a) ? `<button class="icon-button" aria-label="Close ${escapeHtml(a.name)} window" data-action="close" data-id="${a.id}">×</button>` : ''}</div><div class="account-bottom"><span class="status ${a.status}">${escapeHtml(statusLabel(a))}</span><button class="archive" data-action="archive" data-id="${a.id}" ${!isClosed(a) ? 'disabled' : ''}>Archive</button></div>${healthRow(a)}${footprintRow(a)}${profileRow(a)}${networkRow(a)}${screenRow(a)}<div class="network-row"><span>Shop opened after sign-in?</span><button class="text-button" data-action="return-game" data-id="${a.id}" ${isClosed(a) || isBusy(a) ? 'disabled' : ''}>Return to game ↗</button></div></article>`
    )
    .join('');
}
// The merged history, rendered with the activity feed's own markup so it inherits the same styling and cannot
// drift from it: a transition shows the states it moved between, an activity entry shows its message.
function timelineRows(entries) {
  return (
    entries
      .map(entry => {
        const mark = entry.level === 'warning' ? '△' : entry.source === 'session' ? '→' : '•';
        const label =
          entry.source === 'session'
            ? `${entry.accountName ? `${entry.accountName}: ` : ''}${entry.from} → ${entry.to} (${entry.event || 'transition'})${entry.reason ? ` — ${entry.reason}` : ''}`
            : entry.message || '';
        const stamp = entry.at ? new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
        return `<div class="event"><span class="event-mark ${entry.level}">${mark}</span><span class="event-message">${escapeHtml(label)}</span><time datetime="${escapeHtml(entry.at)}">${stamp}</time></div>`;
      })
      .join('') || '<p class="muted">Session transitions and activity will be merged here as sessions run.</p>'
  );
}
// --- The settings form, drawn from the schema (ADR-0017) ---------------------------------------
// The renderer holds no field list. It draws whatever descriptors the main process sends and sends back only the
// controls' values, keyed by the same dotted path an error comes back with — so a field added to
// `config-schema.cjs` appears here without an edit to this file, and an error marks the control that caused it.
let settingsForm = null;

/** One control, in whatever shape its descriptor asked for. */
function settingsControl(field, message) {
  const id = escapeHtml(field.id);
  const described = `data-path="${escapeHtml(field.path)}" id="${id}" name="${id}"`;
  const invalid = message ? ` aria-invalid="true" aria-describedby="${id}-error"` : '';
  const value = field.value === undefined || field.value === null ? '' : String(field.value);
  if (field.control === 'select') {
    const options = (field.options || [])
      .map(
        option => `<option value="${escapeHtml(option.value)}"${option.selected ? ' selected' : ''}>${escapeHtml(option.value)}</option>`
      )
      .join('');
    return `<select ${described}${invalid}>${options}</select>`;
  }
  if (field.control === 'checkbox') {
    return `<input type="checkbox" ${described}${invalid}${field.value === true ? ' checked' : ''} />`;
  }
  if (field.control === 'number') {
    const min = field.min === null || field.min === undefined ? '' : ` min="${field.min}"`;
    const max = field.max === null || field.max === undefined ? '' : ` max="${field.max}"`;
    return `<input type="number" ${described}${invalid} step="1"${min}${max} value="${escapeHtml(value)}" />`;
  }
  // A masked field is shown as set and given no value: it is left alone unless somebody types into it, and
  // because a save sends only what was edited, leaving it alone cannot wipe it.
  const placeholder = field.masked ? 'Set — type to replace' : '';
  return `<input type="text" ${described}${invalid} placeholder="${escapeHtml(placeholder)}" value="${field.masked ? '' : escapeHtml(value)}" />`;
}

/** The whole form: one fieldset per declared group, one label per control. */
function settingsFields(form, errors = {}) {
  return (form.groups || [])
    .map(
      group =>
        `<fieldset class="settings-group"><legend>${escapeHtml(group.label)}</legend>${(group.fields || [])
          .map(field => {
            const message = errors[field.path];
            const required = field.required ? ' <span class="muted">(required)</span>' : '';
            const problem = message
              ? `<span class="field-error" id="${escapeHtml(field.id)}-error" role="alert">${escapeHtml(message)}</span>`
              : '';
            return `<label class="settings-field" for="${escapeHtml(field.id)}"><span>${escapeHtml(field.label)}${required}</span>${settingsControl(field, message)}${problem}</label>`;
          })
          .join('')}</fieldset>`
    )
    .join('');
}

/** Paint the form, marking the named paths. */
function paintSettingsForm(errors = {}) {
  if (!settingsForm) return;
  $('#settings-fields').innerHTML = settingsFields(settingsForm, errors);
}

async function loadSettingsForm() {
  const result = await call(() => poolside.settingsForm());
  if (!result.ok) return;
  settingsForm = result.value;
  paintSettingsForm();
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
  const open = state.accounts.filter(a => !isClosed(a)).length;
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
  // The timeline is the two histories *merged*: session transitions and activity entries in one order, which is
  // what makes a failure readable as a sequence rather than as two lists (ADR-0016).
  const timeline = (state.timeline && state.timeline.entries) || [];
  $('#timeline').innerHTML = timeline.length
    ? `<div class="section-heading"><h2>Timeline <span class="count-pill">${timeline.length}</span></h2><span class="muted">transitions and activity, oldest first</span></div>${timelineRows(timeline.slice(-12).reverse())}`
    : eventRows([]);
  renderAccounts();
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.view) view(button.dataset.view);
  if (button.classList.contains('add-account')) openDialog();
  if (button.dataset.action === 'diagnostics-preview') {
    // Its own branch, before the account-action chain: that chain ends in `poolside.open(id)` as the fallback,
    // so an action with no account would silently try to open one.
    await call(async () => {
      const preview = await poolside.diagnosticsPreview();
      if (preview.ok) {
        const s = preview.value.payload.summary;
        toast(`Diagnostics payload: ${preview.value.entries} timeline entries, ${s.accounts} account(s), no names, addresses or paths.`);
      }
      return preview;
    });
    return;
  }
  if (button.dataset.action) {
    const { action, id } = button.dataset;
    await call(() =>
      action === 'inspect'
        ? poolside.inspect(id)
        : action === 'return-game'
          ? poolside.returnGame(id)
          : action === 'check-ip'
            ? poolside.checkIP(id)
            : action === 'check-route'
              ? poolside.checkRoute(id)
              : action === 'delete-profile'
                ? poolside.deleteProfile(id)
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
  // Only the controls are sent, keyed by their declared path; a blank control is omitted by the mapper, so this
  // cannot clear a field nobody touched.
  const values = {};
  for (const control of $('#settings-fields').querySelectorAll('[data-path]')) {
    values[control.dataset.path] = control.type === 'checkbox' ? String(control.checked) : control.value;
  }
  const result = await call(() => poolside.saveSettings({ values }));
  if (!result.ok) {
    $('#settings-status').textContent = 'Not saved.';
    return;
  }
  const verdict = result.value;
  if (verdict.form) settingsForm = verdict.form;
  // A refusal comes back per field, so the control that caused it is marked. Anything without a field of its own
  // belongs to the form as a whole and goes in the status line.
  const byPath = {};
  for (const problem of verdict.errors || []) if (problem.path) byPath[problem.path] = problem.message;
  paintSettingsForm(byPath);
  const unplaced = (verdict.errors || []).filter(problem => !problem.path).map(problem => problem.message);
  if (!verdict.saved) {
    // The form is rebuilt to mark the field, and rebuilding drops focus with it. Put it back on the control that
    // needs correcting, because that is where the person who just typed has to be.
    const invalid = $('#settings-fields').querySelector('[aria-invalid="true"]');
    if (invalid) invalid.focus();
    $('#settings-status').textContent = unplaced.length
      ? `Not saved: ${unplaced.join('; ')}`
      : 'Not saved. Correct the field marked above.';
    return;
  }
  $('#settings-status').textContent = verdict.ignored?.length
    ? 'Saved. A stored value this form does not own was unusable and has been left out.'
    : 'Preferences saved on this device.';
});
$('#open-all').addEventListener('click', () => call(() => poolside.openAll()));
$('#close-all').addEventListener('click', () => call(() => poolside.closeAll()));
$('#arrange').addEventListener('click', () => call(() => poolside.arrange()));
$('#search').addEventListener('input', renderAccounts);
poolside.subscribe(render);
call(() => poolside.get()).then(result => {
  if (result.ok) loadSettingsForm();
});
