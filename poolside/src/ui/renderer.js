const $ = selector => document.querySelector(selector);
let state = { accounts: [], events: [], settings: { table: 'Bangkok', limit: 10 } };
let toastTimer;
let infoTooltipOwner = null;
const dialogOpeners = new WeakMap();
const navigationTargets = new Map();
// Session states come from the FSM (src/session-fsm.cjs). `closed` is what a session with no open
// window reports, so it appears here even though nothing stores it as a state.
const CLOSED_STATUSES = ['idle', 'closed'];
const BUSY_STATUSES = ['launching', 'loading', 'closing'];
const STATUS_LABELS = {
  idle: '○ Not started',
  closed: '○ Window closed',
  launching: '◌ Starting session…',
  loading: '◌ Loading game…',
  ready: '● Browser window ready',
  degraded: '△ Needs attention',
  closing: '○ Closing…'
};
const SCREEN_LABELS = {
  inspecting: 'Inspecting game…',
  unrecognized: 'Screen not recognized',
  'inspection-failed': 'Inspection failed',
  shop: 'Shop visible',
  loading: 'Loading screen',
  connecting: 'Connecting screen',
  lobby: 'Lobby visible',
  'table-selection': 'Table selector visible',
  'lucky-promotion': 'Lucky Shot promotion',
  'lucky-shot': 'Lucky Shot'
};
const isClosed = account => CLOSED_STATUSES.includes(account.status);
const isBusy = account => BUSY_STATUSES.includes(account.status);
const statusLabel = account => STATUS_LABELS[account.status] || STATUS_LABELS.closed;
const gameScreenLabel = screen => SCREEN_LABELS[screen?.state] || SCREEN_LABELS.unrecognized;
const displayStatusLabel = account =>
  account.status === 'ready' && account.gameScreen ? `● ${gameScreenLabel(account.gameScreen)}` : statusLabel(account);
// A degraded session explains itself: what went wrong, how many recoveries were tried, and whether
// the automatic budget is spent (supervision.cjs owns that policy).
function healthRow(a) {
  if (a.status !== 'degraded') return '';
  const health = a.health || {};
  const attempts = health.attempts ? ` · ${health.attempts} recovery attempt${health.attempts === 1 ? '' : 's'}` : '';
  const next = health.nextAttemptAt ? ` · retrying ${new Date(health.nextAttemptAt).toLocaleTimeString()}` : '';
  const spent = health.exhausted ? ' · automatic recovery stopped; reopen the window to retry' : '';
  const detail = `${a.statusReason || 'Session needs attention'}${attempts}${next}${spent}`;
  return `<div class="network-row health-row"><span>${escapeHtml(detail)}</span><button class="text-button" data-action="reload" data-id="${a.id}" title="Reload this browser page while keeping its isolated saved sign-in." ${isBusy(a) ? 'disabled' : ''}>Reload page ↗</button></div>`;
}
function screenRow(a) {
  const screen = a.gameScreen;
  const attention = a.screenAttention;
  const label = screen
    ? `${gameScreenLabel(screen)}${typeof screen.score === 'number' && screen.score > 0 ? ' · ' + Math.round(screen.score * 100) + '%' : ''}${screen.observedAt ? ' · ' + new Date(screen.observedAt).toLocaleTimeString() : ''}`
    : 'Game screen not inspected';
  const evidence = Array.isArray(screen?.evidence)
    ? screen.evidence.filter(value => typeof value === 'string' && value.trim()).slice(0, 4)
    : [];
  const tables = Array.isArray(screen?.visibleTables)
    ? screen.visibleTables.filter(value => typeof value === 'string' && value.trim()).slice(0, 6)
    : [];
  const source =
    screen?.source === 'bottom-band'
      ? 'Read from the lower status area.'
      : screen?.source === 'full-frame'
        ? 'Read from the game area.'
        : '';
  const tableDetail = tables.length ? `Visible tables: ${tables.join(', ')}.` : '';
  const visualDetail =
    screen?.tableMatch?.method === 'local-evidence'
      ? `Centered table matched against reviewed local Evidence: ${screen.tableMatch.table}.`
      : '';
  const detail = `${evidence.length ? `Matched: ${evidence.join(', ')}.` : ''} ${tableDetail} ${visualDetail} ${source}`.trim();
  const canMonitor = !isClosed(a) && !isBusy(a) && screen?.state !== 'inspecting';
  const monitorLabel = a.monitoring ? 'Stop live status' : 'Start live status';
  const monitorTitle = a.monitoring
    ? 'Stop the local screen-status monitor for this account.'
    : 'Read one visible game screen locally about every 30 seconds. It never clicks or controls the game.';
  const monitorDetail = a.monitoring
    ? `<small class="screen-detail">Live status is on · local screen reading about every ${a.monitorIntervalSeconds || 30} seconds, for every window that is on screen — focused or not.</small>`
    : '';
  return `<div class="network-row screen-row"><span><span class="screen-result">${escapeHtml(label)}</span>${attention ? `<small class="screen-detail screen-attention">${escapeHtml(attention.message)}</small>` : ''}${monitorDetail}${detail ? `<small class="screen-detail">${escapeHtml(detail)}</small>` : ''}</span><span class="screen-actions"><button class="text-button" data-action="inspect" data-id="${a.id}" title="Read one game image locally; this does not verify responsiveness" ${canMonitor ? '' : 'disabled'}>Inspect game ↗</button><button class="text-button" data-action="monitor" data-id="${a.id}" title="${monitorTitle}" ${canMonitor ? '' : 'disabled'}>${monitorLabel}</button></span></div>`;
}
function tableNavigationRow(account) {
  const plan = account.tableNavigation;
  const terminal = !plan || ['complete', 'cancelled', 'failed'].includes(plan.state);
  const tables = Array.isArray(state.tables) && state.tables.length ? state.tables : [state.settings.table];
  const remembered = navigationTargets.get(account.id);
  const selected =
    !terminal && plan?.targetTable
      ? plan.targetTable
      : tables.includes(remembered)
        ? remembered
        : plan?.targetTable || state.settings.table;
  const labels = {
    'locating-lobby': 'Locating lobby',
    'opening-table-selection': 'Open table selection',
    'locating-table': 'Locating target table',
    'target-ready': 'Target table visible',
    'opening-table': 'Opening target table',
    matchmaking: 'Matchmaking observed',
    complete: 'Navigation complete',
    cancelled: 'Dry run cancelled',
    failed: 'Dry run needs attention'
  };
  const options = tables
    .map(table => `<option value="${escapeHtml(table)}" ${table === selected ? 'selected' : ''}>${escapeHtml(table)}</option>`)
    .join('');
  const locked = !terminal;
  const unavailable = isClosed(account) || isBusy(account);
  const instruction = plan?.input?.instruction || 'Choose a target table to build a no-click navigation plan.';
  const recent = Array.isArray(plan?.history) ? plan.history.slice(-4).reverse() : [];
  const history = recent.length
    ? `<details class="navigation-history"><summary>Recent plan events</summary><ol>${recent.map(item => `<li><span>${escapeHtml(item.detail)}</span><time>${new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></li>`).join('')}</ol></details>`
    : '';
  let primary;
  if (plan?.state === 'failed') {
    primary = `<button class="secondary" data-action="navigation-retry" data-id="${account.id}" ${unavailable ? 'disabled' : ''}>Retry dry run</button>`;
  } else if (locked && ['opening-table-selection', 'target-ready'].includes(plan.state)) {
    primary = `<button class="secondary" data-action="navigation-advance" data-id="${account.id}" ${unavailable ? 'disabled' : ''}>I completed this step</button>`;
  } else if (locked) {
    primary = `<button class="secondary" data-action="navigation-observe" data-id="${account.id}" ${unavailable ? 'disabled' : ''}>Check visible screen</button>`;
  } else {
    primary = `<button class="secondary" data-action="navigation-start" data-id="${account.id}" ${unavailable ? 'disabled' : ''}>Start dry run</button>`;
  }
  const cancel = locked
    ? `<button class="text-button" data-action="navigation-cancel" data-id="${account.id}" ${unavailable ? 'disabled' : ''}>Cancel</button>`
    : '';
  return `<section class="navigation-row" aria-label="Table-navigation dry run for ${escapeHtml(account.name)}"><div class="navigation-heading"><span><strong>Table navigation · dry run</strong><small>${escapeHtml(plan ? labels[plan.state] || plan.state : 'Not started')}</small></span><span class="outline-badge">No clicks</span></div><div class="navigation-controls"><label>Target table<select data-navigation-target="${account.id}" aria-label="Target table for ${escapeHtml(account.name)}" ${locked ? 'disabled' : ''}>${options}</select></label><span class="screen-actions">${primary}${cancel}</span></div><p>${escapeHtml(instruction)}</p>${history}</section>`;
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
  if (a.webRTC === 'disable_non_proxied_udp') parts.push('WebRTC held to the route');
  const text = parts.length ? parts.join(' · ') : 'default footprint — no identity or route configured';
  // A value the browser refused is named by its field, with what to do about it, rather than leaving a session
  // that is not what was configured and no indication of which control to clear.
  const refused = (f.refused || [])
    .map(entry => `${entry.field} "${entry.value}" was refused by the browser — clear or correct it in Settings, or in this account's preferences`)
    .join('; ');
  return `<div class="network-row"><span>${escapeHtml(text)}</span><button class="text-button" data-action="check-route" data-id="${a.id}" title="Ask Chromium which route this session will actually use" ${isClosed(a) ? 'disabled' : ''}>Check route ↗</button></div>${
    refused ? `<div class="network-row"><span class="status failed">${escapeHtml(refused)}</span></div>` : ''
  }`;
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
function showDialog(dialogSelector, focusSelector) {
  const dialog = $(dialogSelector);
  dialogOpeners.set(dialog, document.activeElement);
  dialog.showModal();
  requestAnimationFrame(() => $(focusSelector)?.focus());
}
document.querySelectorAll('dialog').forEach(dialog =>
  dialog.addEventListener('close', () => {
    const opener = dialogOpeners.get(dialog);
    if (opener && document.contains(opener)) opener.focus();
  })
);
function toast(message, error = false) {
  $('#toast').textContent = message;
  $('#toast').className = `toast${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.add('hidden'), 5500);
}
function positionInfoTooltip(owner) {
  const tooltip = $('#info-tooltip');
  const edge = 12;
  const gap = 8;
  if (!owner?.isConnected) return hideInfoTooltip(owner);
  if (!tooltip.matches(':popover-open')) tooltip.showPopover();
  const anchor = owner.getBoundingClientRect();
  const box = tooltip.getBoundingClientRect();
  const maximumLeft = Math.max(edge, window.innerWidth - box.width - edge);
  const left = Math.min(Math.max(anchor.left + anchor.width / 2 - box.width / 2, edge), maximumLeft);
  const above = anchor.top - box.height - gap;
  const maximumTop = Math.max(edge, window.innerHeight - box.height - edge);
  const top = Math.min(Math.max(above >= edge ? above : anchor.bottom + gap, edge), maximumTop);
  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}
function showInfoTooltip(owner) {
  const text = owner?.dataset.tip;
  if (!text) return;
  const tooltip = $('#info-tooltip');
  infoTooltipOwner = owner;
  tooltip.textContent = text;
  owner.setAttribute('aria-describedby', 'info-tooltip');
  positionInfoTooltip(owner);
}
function hideInfoTooltip(owner = infoTooltipOwner) {
  if (owner && owner !== infoTooltipOwner) return;
  if (infoTooltipOwner?.isConnected) infoTooltipOwner.removeAttribute('aria-describedby');
  infoTooltipOwner = null;
  const tooltip = $('#info-tooltip');
  if (tooltip.matches(':popover-open')) tooltip.hidePopover();
}
document.addEventListener('pointerover', event => {
  const owner = event.target.closest?.('.info-dot[data-tip]');
  if (owner && !owner.contains(event.relatedTarget)) showInfoTooltip(owner);
});
document.addEventListener('pointerout', event => {
  const owner = event.target.closest?.('.info-dot[data-tip]');
  if (owner && !owner.contains(event.relatedTarget) && document.activeElement !== owner) hideInfoTooltip(owner);
});
document.addEventListener('focusin', event => {
  const owner = event.target.closest?.('.info-dot[data-tip]');
  if (owner) showInfoTooltip(owner);
});
document.addEventListener('focusout', event => {
  const owner = event.target.closest?.('.info-dot[data-tip]');
  if (owner && !owner.matches(':hover')) hideInfoTooltip(owner);
});
document.addEventListener('scroll', () => infoTooltipOwner && positionInfoTooltip(infoTooltipOwner), true);
window.addEventListener('resize', () => infoTooltipOwner && positionInfoTooltip(infoTooltipOwner));
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
  if (!['sessions', 'matches', 'activity', 'accounts', 'capture-lab', 'settings', 'about'].includes(name)) return;
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('hidden', el.id !== `view-${name}`));
  document.querySelectorAll('.nav-item').forEach(el => {
    const active = el.dataset.view === name;
    el.classList.toggle('active', active);
    el.toggleAttribute('aria-current', active);
  });
  $('#breadcrumb').textContent = name === 'capture-lab' ? 'Capture lab' : name[0].toUpperCase() + name.slice(1);
  if (name === 'capture-lab') {
    window.scrollTo(0, 0);
    requestAnimationFrame(() => window.scrollTo(0, 0));
    loadCaptureLab();
  }
}
function updateReceiverRoleHint(selectId, hintId, excludedId = null) {
  const selected = $(`#${selectId}`).value;
  const current = state.accounts.find(account => account.id !== excludedId && account.role === 'receiver');
  $(`#${hintId}`).textContent =
    selected === 'receiver' && current
      ? `${current.name} is currently receiving. Poolside will ask before changing that account to Sending.`
      : '';
}
function openDialog() {
  $('#account-form').reset();
  $('#account-error').textContent = '';
  const hasReceiver = state.accounts.some(a => a.role === 'receiver');
  $('#account-role').value = hasReceiver ? 'sender' : 'receiver';
  $('#account-role option[value="receiver"]').disabled = false;
  updateReceiverRoleHint('account-role', 'account-role-hint');
  showDialog('#account-dialog', '#account-name');
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
        `<article class="account-card"><span class="account-avatar ${a.role}">${escapeHtml(a.name[0].toUpperCase())}</span><div><div class="account-name">${escapeHtml(a.name)}</div><span class="account-role">${a.role === 'receiver' ? 'Receiving account' : 'Sending account'}</span></div><div class="account-actions"><button class="secondary" data-action="${isClosed(a) ? 'open' : 'focus'}" data-id="${a.id}">${isClosed(a) ? 'Open ↗' : 'Focus ↗'}</button>${!isClosed(a) ? `<button class="icon-button" aria-label="Close ${escapeHtml(a.name)} window" data-action="close" data-id="${a.id}">×</button>` : ''}</div><div class="account-bottom"><span class="status ${a.status}">${escapeHtml(displayStatusLabel(a))}</span><button class="archive" data-action="archive" data-id="${a.id}" ${!isClosed(a) ? 'disabled' : ''}>Archive</button></div>${healthRow(a)}${footprintRow(a)}${profileRow(a)}${networkRow(a)}${screenRow(a)}${tableNavigationRow(a)}<div class="network-row"><span>Page tools</span><span class="screen-actions"><button class="text-button" data-action="reload" data-id="${a.id}" title="Reload this browser page while keeping its isolated saved sign-in." ${isClosed(a) || isBusy(a) ? 'disabled' : ''}>Reload page ↗</button><button class="text-button" data-action="return-game" data-id="${a.id}" ${isClosed(a) || isBusy(a) ? 'disabled' : ''}>Return to game ↗</button></span></div></article>`
    )
    .join('');
}
function profileSummary(account) {
  const profile = account.profile;
  if (!profile) return 'Profile has not been measured yet.';
  const parts = [];
  if (profile.established) parts.push('saved browser profile established');
  if (Number.isInteger(profile.generation)) parts.push(`storage generation ${profile.generation}`);
  if (Number.isInteger(profile.directoryBytes)) parts.push(`${formatBytes(profile.directoryBytes)} on disk`);
  if (profile.corruption?.count)
    parts.push(`${profile.corruption.count} quarantined damaged session${profile.corruption.count === 1 ? '' : 's'}`);
  return parts.join(' · ') || 'Profile has not been measured yet.';
}
function overviewValue(value, fallback = 'Uses workspace/browser default') {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}
function overviewRow(label, value, copyValue = null) {
  const copy = copyValue
    ? ` <button class="text-button copy-overview" data-copy="${escapeHtml(copyValue)}" aria-label="Copy ${escapeHtml(label)}">Copy</button>`
    : '';
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}${copy}</dd></div>`;
}
function accountOverview(account) {
  const overview = account.overview;
  if (!overview) return '';
  const identity = overview.identity || {};
  const route = overview.route || {};
  const session = overview.session || {};
  const routeSource = route.presetName ? `Saved preset: ${route.presetName}` : 'Route source: account override or workspace default';
  const routeStatus = route.configured
    ? route.matches === false
      ? `Route mismatch: Chromium reported ${route.verifiedRoute || 'a different route'}`
      : route.matches === true
        ? `Route verified: ${route.verifiedRoute || route.label}`
        : `Configured: ${route.label}`
    : 'No dedicated route configured';
  const items = [
    overviewRow('Session partition', overviewValue(session.partition, 'Unavailable'), session.partition),
    overviewRow('Saved sign-in state', overviewValue(session.persistence)),
    overviewRow('Identity summary', overviewValue(identity.summary)),
    overviewRow('User agent', overviewValue(identity.userAgent), identity.userAgent),
    overviewRow('Languages', overviewValue(identity.acceptLanguages)),
    overviewRow('Locale / timezone', `${overviewValue(identity.locale)} / ${overviewValue(identity.timezone)}`),
    overviewRow('Viewport / colour scheme', `${overviewValue(identity.viewport)} / ${overviewValue(identity.colorScheme)}`),
    overviewRow('Route source', routeSource),
    overviewRow('Network route', routeStatus),
    overviewRow(
      'Public IP',
      route.publicIp
        ? `${route.publicIp}${route.publicIpCheckedAt ? ` · checked ${new Date(route.publicIpCheckedAt).toLocaleTimeString()}` : ''}`
        : 'Not checked'
    )
  ];
  return `<details class="account-disclosure account-overview" data-account-id="${escapeHtml(account.id)}"><summary>Session details</summary><dl class="managed-details account-overview-details">${items.join('')}</dl><p class="account-overview-note">Poolside does not display passwords, cookies, or tokens. These are the configuration values and session facts it can safely verify.</p></details>`;
}
function screenHistory(account) {
  const entries = Array.isArray(account.screenHistory) ? account.screenHistory : [];
  if (!entries.length) return '';
  const rows = entries
    .map(entry => {
      const state = captureLabel(entry.state);
      const confidence = typeof entry.score === 'number' && entry.score > 0 ? ` · ${Math.round(entry.score * 100)}%` : '';
      const time = entry.observedAt ? new Date(entry.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
      return `<li><span>${escapeHtml(state)}${confidence}</span><time datetime="${escapeHtml(entry.observedAt || '')}">${time}</time></li>`;
    })
    .join('');
  return `<details class="account-disclosure screen-history" data-account-id="${escapeHtml(account.id)}"><summary>Recent screen changes <span class="count-pill">${entries.length}</span></summary><ol>${rows}</ol><p>Recorded locally while you inspect or use Live status. Repeated readings of the same screen are not listed.</p></details>`;
}
function visibleReadings(account) {
  const readings = Object.values(account.visibleReadings || {}).filter(reading => Number.isSafeInteger(reading?.value));
  if (!readings.length) return '';
  const rows = readings
    .map(reading => {
      const seen = reading.observedAt ? new Date(reading.observedAt).toLocaleTimeString() : 'time unavailable';
      const status = reading.statusLabel || 'Unstamped reading';
      // An abbreviated figure ("3.23k") is the game's own rounding, so it is shown as approximate rather
      // than as a balance that happens to end in zeros.
      const shown = `${escapeHtml(reading.value.toLocaleString())}${reading.exact === false ? ' approx.' : ''}`;
      return `<div><dt>${escapeHtml(reading.label)}</dt><dd>${shown} <small>· ${escapeHtml(status)} · ${escapeHtml(seen)}</small></dd></div>`;
    })
    .join('');
  return `<section class="visible-readings"><h4>Last visible account readings</h4><dl class="managed-details">${rows}</dl><p>Read locally from this window's own screen. These values are display-only and may be inaccurate; verify them in the game.</p></section>`;
}
// --- Bulk selection on Account management ------------------------------------------------------
// The selection lives in the renderer and is pruned on every paint, so a card that disappears can never
// stay selected. The work itself is one IPC call per action: the main process re-checks every rule and
// asks for confirmation once, because a renderer-side check would be advice rather than a guard.
let managerSelectionMode = false;
const managerSelection = new Set();
function renderBulkBar() {
  const bar = $('#bulk-bar');
  if (!bar) return;
  bar.classList.toggle('hidden', !managerSelectionMode);
  $('#bulk-count').textContent = `${managerSelection.size} of ${state.accounts.length} selected`;
  for (const button of bar.querySelectorAll('[data-bulk]')) button.disabled = !managerSelection.size;
  $('#bulk-all').disabled = !state.accounts.length || managerSelection.size === state.accounts.length;
  $('#bulk-clear').disabled = !managerSelection.size;
}
function setSelectionMode(on) {
  managerSelectionMode = on;
  if (!on) managerSelection.clear();
  const toggle = $('#select-toggle');
  toggle.setAttribute('aria-pressed', String(on));
  toggle.textContent = on ? 'Done selecting' : 'Select accounts';
  renderManagedAccounts();
}
async function runBulk(action) {
  const ids = [...managerSelection];
  if (!ids.length) return;
  const result = await call(() => poolside.bulk({ action, ids }));
  if (!result.ok) return;
  const { changed, skipped } = result.value;
  const noun = `${changed} account${changed === 1 ? '' : 's'}`;
  if (action === 'delete') toast(`${noun} and their local profiles removed.`);
  else if (!changed) toast(`Nothing to do — ${skipped.length ? skipped.join(', ') : 'no accounts'} already in that state.`);
  else if (skipped.length) toast(`${noun} updated; ${skipped.length} left unchanged because they were already in that state.`);
  else toast(`${noun} updated.`);
  // Archiving and removal change which list a card belongs to, so the selection is cleared rather than
  // carried onto whatever now occupies those rows.
  if (action === 'archive' || action === 'delete') managerSelection.clear();
  renderBulkBar();
}
function managedCard(account, archived = false) {
  const screen = account.gameScreen;
  const screenState =
    screen?.state && !['unrecognized', 'inspection-failed'].includes(screen.state) ? screen.state.replaceAll('-', ' ') : 'not inspected';
  const live = !isClosed(account);
  // Only the active list is selectable: an archived slot has no session to open or close, and its two
  // remaining actions are already single-click on its own card.
  const picker =
    !archived && managerSelectionMode
      ? `<input type="checkbox" class="card-picker" data-select-account="${escapeHtml(account.id)}" aria-label="Select ${escapeHtml(account.name)}" ${managerSelection.has(account.id) ? 'checked' : ''} />`
      : '';
  return `<article class="managed-card ${archived ? 'archived' : ''}">
    <div class="managed-card-heading">${picker}<span class="account-avatar ${account.role}">${escapeHtml(account.name[0].toUpperCase())}</span><div><div class="account-name">${escapeHtml(account.name)}</div><span class="account-role">${account.role === 'receiver' ? 'Receiving account' : 'Sending account'} · ${escapeHtml(displayStatusLabel(account))}</span></div><div class="managed-actions">${archived ? `<button class="secondary" data-action="restore" data-id="${account.id}">Restore</button>` : `<button class="secondary" data-action="edit-account" data-id="${account.id}" ${live ? 'disabled title="Close this browser window first"' : ''}>Edit</button><button class="secondary" data-action="account-preferences" data-id="${account.id}" ${live ? 'disabled title="Close this browser window first"' : ''}>Session preferences</button><button class="secondary" data-action="archive" data-id="${account.id}" ${live ? 'disabled' : ''}>Archive</button>`}<button class="danger-button" data-action="delete-account" data-id="${account.id}" ${live ? 'disabled title="Close this browser window first"' : ''}>Remove…</button></div></div>
    ${account.note ? `<p class="account-note"><strong>Local note:</strong> ${escapeHtml(account.note)}</p>` : ''}
    <dl class="managed-details"><div><dt>Browser profile</dt><dd>${escapeHtml(profileSummary(account))}</dd></div><div><dt>Current screen</dt><dd>${escapeHtml(screenState)}${typeof screen?.score === 'number' ? ` · ${Math.round(screen.score * 100)}% match` : ''}</dd></div><div><dt>Public IP check</dt><dd>${account.network?.status === 'checked' ? escapeHtml(account.network.ip) : 'Not checked'}</dd></div><div><dt>Created</dt><dd>${account.createdAt ? escapeHtml(new Date(account.createdAt).toLocaleDateString()) : 'Unknown'}</dd></div></dl>${visibleReadings(account)}${screenHistory(account)}${accountOverview(account)}
  </article>`;
}
function renderManagedAccounts() {
  const archived = state.archivedAccounts || [];
  // A selection cannot outlive the accounts it names: anything archived, removed or renamed away is
  // dropped before the bar reports a count, so "3 selected" can never include a slot that is gone.
  const active = new Set(state.accounts.map(account => account.id));
  for (const id of [...managerSelection]) if (!active.has(id)) managerSelection.delete(id);
  $('#manager-active-count').textContent = state.accounts.length;
  $('#manager-archived-count').textContent = archived.length;
  $('#managed-accounts').innerHTML = state.accounts.length
    ? state.accounts.map(account => managedCard(account)).join('')
    : '<div class="manager-empty">No active account slots. Restore an archived account or add a new one.</div>';
  $('#archived-accounts').innerHTML = archived.length
    ? archived.map(account => managedCard(account, true)).join('')
    : '<div class="manager-empty">No archived account slots.</div>';
  renderBulkBar();
}
function openEditDialog(id) {
  const account = state.accounts.find(candidate => candidate.id === id);
  if (!account || !isClosed(account)) return;
  $('#edit-account-id').value = account.id;
  $('#edit-account-name').value = account.name;
  $('#edit-account-note').value = account.note || '';
  $('#edit-account-role').value = account.role;
  $('#edit-account-role').querySelector('option[value="receiver"]').disabled = false;
  updateReceiverRoleHint('edit-account-role', 'edit-account-role-hint', account.id);
  $('#edit-account-error').textContent = '';
  showDialog('#edit-account-dialog', '#edit-account-name');
}
let accountPreferencesForm = null;
function paintAccountPreferences(errors = {}) {
  if (!accountPreferencesForm) return;
  $('#account-preferences-fields').innerHTML = settingsFields(accountPreferencesForm, errors, 'account-');
}
async function openAccountPreferencesDialog(id) {
  const account = state.accounts.find(candidate => candidate.id === id);
  if (!account || !isClosed(account)) return;
  const result = await call(() => poolside.accountPreferencesForm(id));
  if (!result.ok) return;
  accountPreferencesForm = result.value;
  $('#account-preferences-id').value = id;
  const presetSelect = $('#account-route-preset');
  presetSelect.innerHTML = `<option value="">Use an account-specific route or workspace default</option>${(result.value.routePresets || []).map(preset => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)} · ${escapeHtml(preset.spec)}</option>`).join('')}`;
  presetSelect.value = result.value.routePresetId || '';
  $('#account-preferences-title').textContent = `${account.name} session preferences`;
  $('#account-preferences-status').textContent = 'Optional settings override the workspace defaults for this account.';
  paintAccountPreferences();
  showDialog('#account-preferences-dialog', '#account-preferences-fields :is(input, select, button)');
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

const SETTINGS_HELP = {
  table: 'A label for your preferred 1-on-1 table. Poolside remembers this preference; it does not enter a table for you.',
  limit: 'A local reminder for the number of sessions you want to keep open. It does not affect the game.',
  'identity.userAgent': 'The browser identification string a website sees. Leave blank to use the normal bundled browser value.',
  'identity.acceptLanguages': 'Language preferences sent by the browser, such as en-CA, en.',
  'identity.locale': 'Language and regional formatting used inside this browser window, such as en-CA.',
  'identity.timezone': 'Time zone shown inside this browser window, using a name such as America/St_Johns.',
  'identity.viewport': 'The browser page size in pixels, written as width and height by this form.',
  'identity.colorScheme': 'Whether websites are told this browser prefers a light or dark appearance.',
  'identity.quotaBytes': 'A warning ceiling for the browser cache. Poolside reports when it is exceeded; Chromium does not enforce it.',
  'proxy.enabled': 'Turns the route below on for newly opened sessions. Leave it off to use your normal network connection.',
  'proxy.spec':
    'Optional proxy address in host:port, scheme://host:port, or user:password@host:port form. It is applied to the isolated session only.',
  'proxy.bypass': 'Optional hosts that should skip the route, separated with commas. Most people can leave this blank.',
  'recovery.shopReturnDelaySeconds':
    'How many seconds Poolside waits after confirming the shop before returning this browser window to the game. This does not affect gameplay.',
  'recovery.backgroundThrottling':
    'Keeps this browser window active when it is in the background. Turn this on only if the game pauses or freezes while you use another window.',
  'recovery.repaintMitigation':
    'Requests several display refreshes after the game page loads. It can help if a loaded game window appears blank or frozen.',
  'recovery.monitorIntervalSeconds':
    "How often, in seconds, live status reads this window's screen while you have it open. Every open window is read, focused or not — one that is hidden or minimised is skipped, and read again the moment it is back on screen."
};
function settingHelp(path) {
  const text = SETTINGS_HELP[path] || 'This is a local Poolside setting. It is checked before saving.';
  return `<span class="info-dot" tabindex="0" data-tip="${escapeHtml(text)}" aria-label="Help for this setting">i</span>`;
}

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
function settingsFields(form, errors = {}, idPrefix = '') {
  return (form.groups || [])
    .map(
      group =>
        `<fieldset class="settings-group"><legend>${escapeHtml(group.label)}</legend>${(group.fields || [])
          .map(sourceField => {
            const field = { ...sourceField, id: `${idPrefix}${sourceField.id}` };
            const message = errors[field.path];
            const required = field.required ? ' <span class="muted">(required)</span>' : '';
            const problem = message
              ? `<span class="field-error" id="${escapeHtml(field.id)}-error" role="alert">${escapeHtml(message)}</span>`
              : '';
            return `<label class="settings-field" for="${escapeHtml(field.id)}"><span>${escapeHtml(field.label)}${settingHelp(field.path)}${required}</span>${settingsControl(field, message)}${problem}</label>`;
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
function openAccountDisclosureIds() {
  return new Set(
    [...document.querySelectorAll('.account-disclosure[open]')]
      .map(node => `${node.classList.contains('screen-history') ? 'history' : 'session'}:${node.dataset.accountId}`)
      .filter(id => !id.endsWith(':'))
  );
}
function restoreAccountDisclosureIds(ids) {
  for (const value of ids) {
    const [kind, id] = value.split(':');
    const selector = kind === 'history' ? '.screen-history' : '.account-overview';
    document.querySelector(`${selector}[data-account-id="${id}"]`)?.setAttribute('open', '');
  }
}
function renderWorkspaceState() {
  const openAccounts = state.accounts.filter(account => !isClosed(account));
  const label = $('#workspace-state-label');
  const detail = $('#workspace-state-detail');
  if (!openAccounts.length) {
    label.textContent = 'No browser sessions open';
    detail.textContent = 'Open a game window to begin local screen observation.';
    return;
  }
  const receiver = openAccounts.find(account => account.role === 'receiver');
  const ordered = receiver ? [receiver, ...openAccounts.filter(account => account.id !== receiver.id)] : openAccounts;
  const observed = ordered.find(account => account.gameScreen && account.gameScreen.state !== 'inspecting');
  if (observed) {
    label.textContent = gameScreenLabel(observed.gameScreen);
    detail.textContent = `${observed.name} · live local screen status${observed.monitoring ? '' : ' (monitor paused)'}.`;
    return;
  }
  const busy = ordered.find(isBusy);
  if (busy) {
    label.textContent = statusLabel(busy).replace(/^[○◌●△]\s*/, '');
    detail.textContent = `${busy.name} · waiting for the first local screen reading.`;
    return;
  }
  label.textContent = 'Browser session ready — waiting for game screen';
  detail.textContent = 'Live status starts automatically and reads every game window that is on screen, focused or not.';
}
let activityFilter = 'all';
function filteredActivity(entries) {
  if (activityFilter === 'warning') return entries.filter(entry => entry.level === 'warning');
  if (activityFilter === 'session') return entries.filter(entry => entry.source === 'session');
  return entries;
}
// Each saved location lists the accounts, one tick box each, so assigning one is a click here rather
// than a trip through that account's preferences dialog.
function routePresetAccounts(preset) {
  const accounts = (state.accounts || []).filter(account => !account.archived);
  if (!accounts.length) return '<p class="muted route-preset-accounts">Add an account, then tick it here to use this location.</p>';
  return `<div class="route-preset-accounts">${accounts
    .map(account => {
      const checked = account.routePresetId === preset.id;
      return `<label><input type="checkbox" data-route-preset-assign="${escapeHtml(preset.id)}" data-route-account="${escapeHtml(account.id)}"${checked ? ' checked' : ''} aria-label="${escapeHtml(`Connect ${account.name} from ${preset.name}`)}" /> ${escapeHtml(account.name)}</label>`;
    })
    .join('')}</div>`;
}
function renderRoutePresets() {
  const presets = state.routePresets || [];
  $('#route-preset-list').innerHTML = presets.length
    ? presets
        .map(
          preset =>
            `<div class="route-preset"><strong>${escapeHtml(preset.name)}</strong><span>${escapeHtml(preset.enabled ? preset.spec : `${preset.spec} · disabled`)}${preset.bypass ? ` · bypass ${escapeHtml(preset.bypass)}` : ''}</span><button class="text-button" data-route-preset-delete="${escapeHtml(preset.id)}">Remove</button></div>${routePresetAccounts(preset)}`
        )
        .join('')
    : '<p class="muted">No saved network locations yet.</p>';
}
function renderCapabilityReport() {
  const report = state.capabilityReport;
  if (!report || !Array.isArray(report.capabilities)) {
    $('#about-build').textContent = 'Capability status unavailable.';
    $('#about-capabilities').textContent = '';
    $('#about-support').textContent = '';
    return;
  }
  $('#about-build').textContent = `Poolside v${report.version} · ${report.channel}`;
  $('#about-capabilities').innerHTML = report.capabilities
    .map(
      item =>
        `<article class="capability-item"><div><strong>${escapeHtml(item.name)}</strong><span class="capability-mode">${escapeHtml(item.mode)} · ${escapeHtml(item.validation)} · flag ${escapeHtml(item.flag)}</span></div><p>${escapeHtml(item.detail)}</p></article>`
    )
    .join('');
  const support = report.support || {};
  const labels = {
    stage: 'Stage',
    targetWindows: 'Windows target',
    gameLocale: 'Game locale',
    display: 'Display target',
    lifetime: 'Support lifetime'
  };
  $('#about-support').innerHTML = Object.entries(labels)
    .map(([key, label]) => `<dt>${label}</dt><dd>${escapeHtml(support[key] || 'Not specified')}</dd>`)
    .join('');
}
const MATCH_LABELS = { active: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };
function matchWhen(match) {
  const date = new Date(match.endedAt || match.startedAt);
  return Number.isNaN(date.getTime()) ? 'an unknown time' : date.toLocaleString();
}
const sessionText = participant => {
  if (!participant.open) return 'session not loaded';
  const base = `session ${STATUS_LABELS[participant.session] || participant.session}`;
  if (!participant.route || participant.route.required !== true) return base;
  return `${base} · ${participant.route.ok === true ? 'route verified' : 'route not verified'}`;
};
function matchSessions(match) {
  const participants = match.participants || [];
  if (!participants.length || !Object.prototype.hasOwnProperty.call(participants[0], 'open')) return '';
  return `<ul class="match-sessions">${participants
    .map(
      participant =>
        `<li class="${participant.releasable === true ? 'loaded' : 'unloaded'}"><span>${escapeHtml(participant.name)}</span> <small>${escapeHtml(
          sessionText(participant)
        )}</small></li>`
    )
    .join('')}</ul>`;
}
function matchReadiness(match) {
  const readiness = match.readiness;
  if (!readiness) return '';
  const participants = match.participants || [];
  // Every participant that cannot be released, named with the check that failed rather than just "not
  // ready": a closed window, a session that has not loaded, and a route that is not being honoured are
  // three different problems and the operator fixes them differently.
  const blocking = participants.filter(participant => participant.releasable !== true);
  const detail =
    readiness.verdict === 'ready'
      ? `Released — every profile is ready${
          Number.isFinite(readiness.skewMs) ? ` (${(readiness.skewMs / 1000).toFixed(1)} s from request to release)` : ''
        }.`
      : readiness.verdict === 'blocked'
        ? `Release blocked — ${readiness.reason}`
        : `Waiting for ${blocking.map(entry => `${entry.name}: ${entry.detail || 'not ready'}`).join('; ') || 'the profiles'}`;
  return `<small class="match-meta match-readiness ${readiness.verdict}">${escapeHtml(detail)}</small>`;
}
// Pairing evidence: what the two sessions' own screen readings amounted to. A connecting screen says nothing
// about which match it is connecting to, so the verdict is allowed to be "not enough evidence" — and that is
// what it says rather than claiming a pairing the evidence does not support.
function matchPairing(match, actionable) {
  if (match.readiness?.verdict !== 'ready') return '';
  const pairing = match.pairing;
  const detail = pairing ? `${pairing.label} — ${pairing.reason}` : 'Not judged yet.';
  const verdict = pairing ? pairing.verdict : 'incomplete';
  const action = actionable
    ? `<button class="text-button" data-action="match-pairing" data-match="${escapeHtml(match.matchId)}">Check pairing evidence</button>`
    : '';
  return `<small class="match-meta match-pairing ${escapeHtml(verdict)}">Pairing evidence: ${escapeHtml(detail)}</small><div class="match-actions">${action}</div>`;
}
// The count-in: one exact moment to aim at, the order to click in, and then the measurement of what two hands
// actually achieved. It is the operator's click that queues an account — this only says how close together
// the two clicks landed, read from the two sessions' own screens.
function matchRelease(match, actionable) {
  if (match.readiness?.verdict !== 'ready') return '';
  const button = (label, action) =>
    `<button class="secondary" data-action="${action}" data-match="${escapeHtml(match.matchId)}">${label}</button>`;
  const release = match.release;
  if (!release)
    return `<small class="match-meta">Queue both windows by hand: the count-in gives you one moment to aim at, then measures the gap your two clicks produced.</small>${
      actionable ? `<div class="match-actions">${button('Count me in — 5 s', 'match-arm')}</div>` : ''
    }`;
  const stop = actionable && ['counting', 'go'].includes(release.phase) ? button('Stop the count-in', 'match-arm-cancel') : '';
  return `<small class="match-meta match-release ${escapeHtml(release.phase)}">${escapeHtml(release.line)}</small>${
    stop ? `<div class="match-actions">${stop}</div>` : ''
  }`;
}
function matchCard(match, actionable) {
  const [first, second] = match.participants || [];
  const needsLoad =
    actionable && (match.readiness?.verdict === 'blocked' || (match.participants || []).some(participant => !participant.open));
  // A match the ledger calls in progress while no session is behind it is the one state that reads as a
  // contradiction to the operator — "I am already in a match" with nothing open. Say what is true and what
  // to do about it rather than leaving them to work it out from a counter.
  const empty = actionable && (match.participants || []).length > 0 && (match.participants || []).every(participant => !participant.open);
  const note = empty
    ? `<small class="match-meta match-empty">No session is open for this match, so it is not really in progress. Cancel it to free ${(
        match.participants || []
      )
        .map(participant => participant.name)
        .join(' and ')}, or load both profiles to carry on with it.</small>`
    : '';
  const outcome =
    match.state === 'completed'
      ? `${match.winnerName || 'A participant'} recorded as the winner`
      : match.state === 'cancelled'
        ? 'No result recorded'
        : 'In progress';
  const actions =
    actionable && first && second
      ? `<div class="match-actions">
            ${
              needsLoad
                ? `<button class="secondary" data-action="match-load" data-match="${escapeHtml(match.matchId)}">Load both profiles</button>`
                : ''
            }
            <button class="secondary" data-action="match-complete" data-match="${escapeHtml(match.matchId)}" data-winner="${escapeHtml(first.id)}">${escapeHtml(first.name)} won</button>
            <button class="secondary" data-action="match-complete" data-match="${escapeHtml(match.matchId)}" data-winner="${escapeHtml(second.id)}">${escapeHtml(second.name)} won</button>
            <button class="text-button" data-action="match-cancel" data-match="${escapeHtml(match.matchId)}">Cancel</button>
          </div>`
      : '';
  return `<article class="match-card ${match.state}">
      <div class="match-card-head">
        <strong>${escapeHtml((match.participants || []).map(participant => participant.name).join(' vs '))}</strong>
        <span class="match-handle">${escapeHtml(match.handle)}</span>
      </div>
      <small class="match-meta">${escapeHtml(outcome)} · ${escapeHtml(MATCH_LABELS[match.state] || match.state)} · ${escapeHtml(matchWhen(match))}</small>
      ${note}
      ${matchReadiness(match)}
      ${matchPairing(match, actionable)}
      ${matchRelease(match, actionable)}
      ${matchSessions(match)}
      ${match.reason ? `<small class="match-meta">${escapeHtml(match.reason)}</small>` : ''}
      ${actions}
    </article>`;
}
function paintMatchSelect(selector) {
  const select = $(selector);
  const previous = select.value;
  select.innerHTML = ['<option value="">Choose an account…</option>']
    .concat(state.accounts.map(account => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}</option>`))
    .join('');
  if (state.accounts.some(account => account.id === previous)) select.value = previous;
}
// --- Run plan ------------------------------------------------------------------------------------
// A run is the plan above the matches: the same two accounts, a limit, and the conditions that stop it.
function paintRunTable() {
  const select = $('#run-table');
  const previous = select.value;
  select.innerHTML = (state.tables || []).map(table => `<option value="${escapeHtml(table)}">${escapeHtml(table)}</option>`).join('');
  select.value = (state.tables || []).includes(previous) ? previous : state.settings.table;
}
function runProgress(run) {
  const progress = run.progress || {};
  const minutesOf = ms => Math.round((ms || 0) / 60000);
  const elapsed = `${minutesOf(progress.elapsedMs)} min`;
  const parts = [
    `${progress.completed || 0} of ${run.plan.matchLimit} with a result`,
    `${progress.cancelled || 0} with no result${progress.consecutiveFailures ? ` (${progress.consecutiveFailures} in a row)` : ''}`,
    run.plan.stopAfterMinutes > 0 ? `${elapsed} of ${run.plan.stopAfterMinutes} min` : `${elapsed} so far`
  ];
  if (progress.consecutiveUnconfirmed) parts.push(`${progress.consecutiveUnconfirmed} without a confirmed pairing`);
  if (progress.pausedMs) parts.push(`${minutesOf(progress.pausedMs)} min paused, not counted`);
  return parts.join(' · ');
}
// What the session itself is showing, as an observation rather than a claim: the target table being visible
// is reported, never required, and "no reading" stays different from "the table is not on screen".
function runParticipantLine(entry, targetTable) {
  if (!entry.screen) return 'no screen reading yet';
  if (entry.screen.identified) return `showing ${targetTable}`;
  if (entry.screen.listed) return `${targetTable} is listed on the screen`;
  return `${entry.screen.state || 'screen not recognized'} — ${targetTable} not identified yet`;
}
// Where the run is and what to do about it, as the coordinator derived it. Rendered as a definition list
// because it is exactly that: a short set of named facts someone reads at a glance mid-run.
function runStatus(status) {
  if (!status) return '';
  const rows = [
    ['Stage', status.stageLabel],
    ['Attempt', `${status.attempt.number} · ${status.attempt.planned} in the plan`],
    ['Release', status.release],
    ['Screens', status.observations.map(entry => entry.line).join(' ')]
  ];
  if (status.pairing) rows.push(['Pairing', status.pairing.line]);
  rows.push([status.stop ? 'Stopped' : 'Next stop', status.stop ? `${status.stop.label}. ${status.stop.reason}` : status.nextStop]);
  rows.push(['Next', status.nextAction]);
  return `<dl class="run-status ${escapeHtml(status.attention)}">${rows
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || '—')}</dd>`)
    .join('')}</dl>`;
}
function runCard(run, actionable) {
  // `running` decides which controls to draw: a paused run is not finished, so it must still offer Resume and
  // Stop. (Gating on `state === 'active'` left a paused run with no buttons at all — no way back and no way
  // out — and the operator's own report was "there was no resume match button visible".)
  const running = run.state !== 'ended';
  const active = run.state === 'active';
  const participants = (run.participants || []).length
    ? `<ul class="match-sessions">${run.participants
        .map(
          entry =>
            `<li class="${entry.releasable === true ? 'loaded' : 'unloaded'}"><span>${escapeHtml(entry.name)} (${escapeHtml(
              entry.role
            )})</span> <small>${escapeHtml(`${sessionText(entry)} · ${runParticipantLine(entry, run.plan.table)}`)}</small></li>`
        )
        .join('')}</ul>`
    : '';
  const outcome = run.outcomeLabel
    ? `<small class="match-meta run-outcome">${escapeHtml(`${run.outcomeLabel} — ${run.reason}`)}</small>`
    : '';
  const actions =
    actionable && running
      ? `<div class="match-actions">
            ${
              run.paused
                ? `<button class="secondary" data-action="run-resume" data-run="${escapeHtml(run.runId)}">Resume run</button>`
                : `<button class="secondary" data-action="run-pause" data-run="${escapeHtml(run.runId)}">Pause run</button>`
            }
            <button class="text-button" data-action="run-stop" data-run="${escapeHtml(run.runId)}">Stop run</button>
          </div>`
      : '';
  return `<article class="match-card run-card ${escapeHtml(run.state)}">
      <div class="match-card-head">
        <strong>${escapeHtml((run.participants || []).map(entry => entry.name).join(' vs '))}</strong>
        <span class="match-handle">${escapeHtml(run.handle)}</span>
      </div>
      <small class="match-meta">${escapeHtml(run.describe)}</small>
      <ul class="run-bounds">${run.bounds.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
      <small class="match-meta">${escapeHtml(active ? runProgress(run) : `${runProgress(run)} · ${matchWhen(run)}`)}</small>
      ${runStatus(run.status)}
      ${participants}
      ${outcome}
      ${actions}
    </article>`;
}
function renderMatches() {
  const matches = state.matches || { totals: {}, active: [], recent: [], runs: { active: null, recent: [] } };
  const totals = matches.totals || {};
  const runs = matches.runs || { active: null, recent: [] };
  $('#match-total').textContent = totals.active || 0;
  paintMatchSelect('#match-first');
  paintMatchSelect('#match-second');
  paintRunTable();
  const first = $('#match-first').value;
  const second = $('#match-second').value;
  $('#match-start').disabled = !first || !second || first === second;
  // A match the ledger calls in progress that no session is behind: say so here, where the operator is
  // looking when the start is refused, rather than only on the card further down the panel.
  const stuck = matches.active.find(
    match => (match.participants || []).length && match.participants.every(participant => !participant.open)
  );
  $('#match-hint').textContent =
    state.accounts.length < 2
      ? 'Match coordination needs two accounts in the workspace.'
      : first && first === second
        ? 'Choose two different accounts.'
        : `${totals.recorded || 0} local record${totals.recorded === 1 ? '' : 's'}: ${totals.completed || 0} completed, ${totals.cancelled || 0} cancelled, ${totals.active || 0} in progress.${
            stuck
              ? ` ${stuck.handle} has nothing open behind it — cancel it below to free ${stuck.participants.map(participant => participant.name).join(' and ')}.`
              : ''
          }`;
  $('#match-active').innerHTML = matches.active.length
    ? matches.active.map(match => matchCard(match, true)).join('')
    : '<p class="muted">No match in progress.</p>';
  $('#match-recent').innerHTML = matches.recent.length
    ? matches.recent.map(match => matchCard(match, false)).join('')
    : '<p class="muted">No results recorded yet.</p>';
  $('#run-start').disabled = !first || !second || first === second || Boolean(runs.active);
  $('#run-hint').textContent = runs.active
    ? runs.active.paused
      ? `${runs.active.handle} is paused: no further match will be started, and the time it spends paused does not count against the plan. The match in progress is not affected. Resume it when you are ready.`
      : `${runs.active.handle} is in progress: ${runs.active.describe}. Start match adds the next match to it.`
    : !first || !second || first === second
      ? 'Choose two different accounts above, then start a run with them.'
      : `A run would be between ${state.accounts.find(a => a.id === first).name} and ${state.accounts.find(a => a.id === second).name}, using the plan above.`;
  $('#run-active').innerHTML = runs.active
    ? runCard(runs.active, true)
    : '<p class="muted">No run in progress. A match started on its own is not part of a run.</p>';
  $('#run-recent').innerHTML = runs.recent.length
    ? runs.recent.map(run => runCard(run, false)).join('')
    : '<p class="muted">No runs recorded yet.</p>';
}
function render(next) {
  const openDetails = openAccountDisclosureIds();
  state = next;
  document.querySelectorAll('.app-version').forEach(element => {
    element.textContent = state.version ? `Poolside v${state.version}` : 'Poolside';
  });
  const open = state.accounts.filter(a => !isClosed(a)).length;
  $('#account-count').textContent = state.accounts.length;
  $('#open-count').textContent = open;
  $('#nav-count').textContent = state.accounts.length;
  $('#section-count').textContent = state.accounts.length;
  $('#window-hint').textContent = open ? 'Independent saved profiles' : 'Ready when you are';
  const inspected = state.accounts.filter(
    account => account.gameScreen && account.gameScreen.state && account.gameScreen.state !== 'inspecting'
  );
  const recognized = inspected.filter(account => !['unrecognized', 'inspection-failed'].includes(account.gameScreen.state));
  $('#inspection-status').textContent = !open ? 'Waiting' : !inspected.length ? 'Ready' : recognized.length ? 'Observed' : 'Not recognized';
  $('#inspection-hint').textContent = !open
    ? 'Open a game window to inspect its screen'
    : !inspected.length
      ? 'Live status starts automatically while a game window is on screen'
      : recognized.length
        ? `${recognized.length} current screen${recognized.length === 1 ? '' : 's'} recognized locally`
        : 'The last inspected screen could not be recognized';
  renderWorkspaceState();
  $('#receiver-name').textContent = state.accounts.find(a => a.role === 'receiver')?.name || 'Not selected';
  $('#sender-count').textContent = state.accounts.filter(a => a.role === 'sender').length;
  $('#table-value').textContent = state.settings.table;
  $('#limit-value').textContent = state.settings.limit;
  $('#open-all').disabled = !state.accounts.length;
  $('#close-all').disabled = !open;
  $('#arrange').disabled = !open;
  $('#recent-events').innerHTML = eventRows(state.events.slice(0, 3));
  $('#all-events').innerHTML = eventRows(state.events.slice(0, 50));
  const history = state.activityHistory || {};
  $('#activity-history-note').textContent = history.saved
    ? `${history.entries || 0} redacted activity message${history.entries === 1 ? '' : 's'} saved locally (up to ${history.limit}). Browser contents, passwords, cookies and tokens are never added.`
    : 'Activity is available for this app session. No passwords or tokens are recorded.';
  // The timeline is the two histories *merged*: session transitions and activity entries in one order, which is
  // what makes a failure readable as a sequence rather than as two lists (ADR-0016).
  const timeline = (state.timeline && state.timeline.entries) || [];
  const visibleActivity = filteredActivity(timeline).slice().reverse().slice(0, 10);
  $('#activity-visible-count').textContent = visibleActivity.length;
  $('#timeline').innerHTML = visibleActivity.length
    ? timelineRows(visibleActivity)
    : '<p class="muted">No recent entries match this filter.</p>';
  renderAccounts();
  renderManagedAccounts();
  renderRoutePresets();
  renderCapabilityReport();
  renderMatches();
  restoreAccountDisclosureIds(openDetails);
}
document.addEventListener('click', async event => {
  const copy = event.target.closest('button.copy-overview');
  if (copy) {
    try {
      await navigator.clipboard.writeText(copy.dataset.copy || '');
      toast('Copied to the clipboard.');
    } catch {
      toast('Could not copy this value.', true);
    }
    return;
  }

  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.view) view(button.dataset.view);
  if (button.classList.contains('add-account')) openDialog();
  if (button.dataset.bulk) {
    await runBulk(button.dataset.bulk);
    return;
  }
  if (button.dataset.action === 'backup-export' || button.dataset.action === 'backup-import') {
    // Not routed through `call`: that helper re-renders whenever a result carries an `accounts` key, and
    // these results describe a folder rather than a workspace snapshot.
    const exporting = button.dataset.action === 'backup-export';
    try {
      const result = exporting ? await poolside.backupExport() : await poolside.backupImport();
      if (!result.ok) throw new Error(result.error);
      const value = result.value || {};
      if (exporting) {
        const folder = String(value.folder || '')
          .split(/[\\/]/)
          .pop();
        toast(`Backup written to ${folder}: ${value.accountCount} account(s), ${value.profileCount} browser profile(s).`);
      } else {
        const parts = [`${(value.restored || []).length} account(s) restored`];
        if (value.present?.length) parts.push(`${value.present.length} already in this workspace`);
        if (value.conflicts?.length) parts.push(`${value.conflicts.length} skipped — ${value.conflicts[0].reason}`);
        toast(`${parts.join(' · ')}.`);
      }
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }
  if (['diagnostics-preview', 'diagnostics-save', 'diagnostics-open-folder', 'activity-history-clear'].includes(button.dataset.action)) {
    // Its own branch, before the account-action chain: that chain ends in `poolside.open(id)` as the fallback,
    // so an action with no account would silently try to open one.
    await call(async () => {
      const action = button.dataset.action;
      if (action === 'activity-history-clear') {
        const result = await poolside.clearActivityHistory();
        if (result.ok) toast('Saved activity history erased from this PC.');
        return result;
      }
      const saving = action === 'diagnostics-save';
      const opening = action === 'diagnostics-open-folder';
      const result = opening
        ? await poolside.diagnosticsOpenFolder()
        : saving
          ? await poolside.diagnosticsSave()
          : await poolside.diagnosticsPreview();
      if (result.ok) {
        if (opening) toast('Opened the local diagnostics folder.');
        else if (saving) toast(`Redacted diagnostics saved locally: ${result.value.fileName} (${result.value.entries} timeline entries).`);
        else {
          const s = result.value.payload.summary;
          toast(`Diagnostics payload: ${result.value.entries} timeline entries, ${s.accounts} account(s), no names, addresses or paths.`);
        }
      }
      return result;
    });
    return;
  }
  if (['run-stop', 'run-pause', 'run-resume'].includes(button.dataset.action)) {
    // Three different things, said as three different things: pausing keeps the run and the match being
    // played and starts nothing further; resuming lets it continue; stopping ends the plan and cancels a
    // match it was still holding.
    const runId = button.dataset.run;
    const action = button.dataset.action;
    const result = await call(() =>
      action === 'run-pause'
        ? poolside.pauseRun({ runId })
        : action === 'run-resume'
          ? poolside.resumeRun({ runId })
          : poolside.stopRun({ runId })
    );
    if (!result.ok) return;
    toast(
      action === 'run-pause'
        ? 'Run paused. The match in progress is not affected; nothing new will be started until you resume.'
        : action === 'run-resume'
          ? 'Run resumed. The time it spent paused does not count against the plan.'
          : 'Run stopped. A match it was still holding has been cancelled.'
    );
    return;
  }
  if (button.dataset.action === 'match-pairing') {
    // Asking again is what the operator does after looking at both windows. The reply says what the screens
    // amount to now, including when the answer is still "not enough evidence".
    const result = await call(() => poolside.checkMatchPairing({ matchId: button.dataset.match }));
    if (!result.ok) return;
    const pairing = result.value?.pairing;
    toast(pairing ? `${pairing.label}: ${pairing.reason}` : 'Pairing evidence is not available yet.');
    return;
  }
  if (['match-arm', 'match-arm-cancel'].includes(button.dataset.action)) {
    // Starting a count-in, or stopping one before GO. Neither queues anything by itself; the click does.
    const starting = button.dataset.action === 'match-arm';
    const result = await call(() =>
      starting ? poolside.armRelease({ matchId: button.dataset.match }) : poolside.cancelRelease({ matchId: button.dataset.match })
    );
    if (!result.ok) return;
    toast(
      starting
        ? 'Count-in started — watch the card, it will call GO and then measure your two clicks.'
        : 'Count-in stopped. Nothing was queued by it.'
    );
    return;
  }
  if (['match-load', 'match-complete', 'match-cancel'].includes(button.dataset.action)) {
    const matchId = button.dataset.match;
    const completing = button.dataset.action === 'match-complete';
    const loading = button.dataset.action === 'match-load';
    const result = await call(() =>
      loading
        ? poolside.loadMatchSessions({ matchId })
        : completing
          ? poolside.completeMatch({ matchId, winner: button.dataset.winner })
          : poolside.cancelMatch({ matchId })
    );
    if (!result.ok) return;
    if (loading) {
      const failed = (result.value?.load || []).filter(entry => !entry.opened);
      toast(failed.length ? `${failed[0].name} could not be loaded: ${failed[0].error}` : 'Both profiles are loading.', failed.length > 0);
    } else {
      toast(completing ? 'Result recorded in the local ledger.' : 'Match cancelled.');
    }
    return;
  }
  if (button.dataset.action) {
    const { action, id } = button.dataset;
    if (action.startsWith('navigation-')) {
      const selected =
        navigationTargets.get(id) ||
        state.accounts.find(account => account.id === id)?.tableNavigation?.targetTable ||
        state.settings.table;
      const result = await call(() =>
        action === 'navigation-start'
          ? poolside.startTableNavigation({ id, targetTable: selected })
          : action === 'navigation-observe'
            ? poolside.observeTableNavigation(id)
            : action === 'navigation-advance'
              ? poolside.advanceTableNavigation(id)
              : action === 'navigation-retry'
                ? poolside.retryTableNavigation(id)
                : poolside.cancelTableNavigation(id)
      );
      if (result.ok && action === 'navigation-start') toast(`Dry-run navigation planned for ${selected}.`);
      return;
    }
    await call(() =>
      action === 'inspect'
        ? poolside.inspect(id)
        : action === 'reload'
          ? poolside.reload(id)
          : action === 'monitor'
            ? state.accounts.find(account => account.id === id)?.monitoring
              ? poolside.stopMonitor(id)
              : poolside.startMonitor(id)
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
                      : action === 'restore'
                        ? poolside.restore(id)
                        : action === 'delete-account'
                          ? poolside.deleteAccount(id)
                          : action === 'edit-account'
                            ? (openEditDialog(id), Promise.resolve({ ok: true }))
                            : action === 'account-preferences'
                              ? (openAccountPreferencesDialog(id), Promise.resolve({ ok: true }))
                              : action === 'close'
                                ? poolside.close(id)
                                : poolside.open(id)
    );
  }
});
document.addEventListener('change', event => {
  const select = event.target.closest('select[data-navigation-target]');
  if (select) navigationTargets.set(select.dataset.navigationTarget, select.value);
});
// Subscribe and paint before the element-by-element wiring below. A missing node used to abort the
// whole script and leave an empty workspace with no accounts, which read as "everything was deleted".
// Keeping the render path first means the workspace still paints even if one control fails to wire.
poolside.subscribe(render);
call(() => poolside.get()).then(result => {
  if (result.ok) loadSettingsForm();
});
$('#match-form').addEventListener('submit', async event => {
  event.preventDefault();
  const result = await call(() => poolside.startMatch({ first: $('#match-first').value, second: $('#match-second').value }));
  if (!result.ok) return;
  const failed = (result.value?.load || []).filter(entry => !entry.opened);
  toast(
    failed.length
      ? `Match started, but ${failed[0].name} could not be loaded: ${failed[0].error}`
      : 'Match started and both profiles are loading. Record the result when it settles.',
    failed.length > 0
  );
});
for (const id of ['match-first', 'match-second']) $(`#${id}`).addEventListener('change', renderMatches);
// Starting a run is starting its first match with a plan attached, so it uses the same two account selects
// as "Start match" and the same loading path.
$('#run-form').addEventListener('submit', async event => {
  event.preventDefault();
  const result = await call(() =>
    poolside.startRun({
      first: $('#match-first').value,
      second: $('#match-second').value,
      plan: {
        table: $('#run-table').value,
        matchLimit: Number($('#run-limit').value),
        stopAfterFailures: Number($('#run-failures').value),
        stopAfterMinutes: Number($('#run-minutes').value)
      }
    })
  );
  if (!result.ok) return;
  const failed = (result.value?.load || []).filter(entry => !entry.opened);
  const run = result.value?.runs?.active;
  toast(
    failed.length
      ? `Run started, but ${failed[0].name} could not be loaded: ${failed[0].error}`
      : `${run ? `${run.handle} started: ${run.describe}.` : 'Run started.'} Both profiles are loading.`,
    failed.length > 0
  );
});
$('.brand').addEventListener('click', event => {
  event.preventDefault();
  view('sessions');
});
$('#cancel-dialog').addEventListener('click', () => $('#account-dialog').close());
$('#cancel-edit-dialog').addEventListener('click', () => $('#edit-account-dialog').close());
$('#cancel-account-preferences-dialog').addEventListener('click', () => $('#account-preferences-dialog').close());
$('#account-role').addEventListener('change', () => updateReceiverRoleHint('account-role', 'account-role-hint'));
$('#edit-account-role').addEventListener('change', () =>
  updateReceiverRoleHint('edit-account-role', 'edit-account-role-hint', $('#edit-account-id').value)
);
$('#account-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  const result = await call(() => poolside.add({ name: $('#account-name').value, role: $('#account-role').value }));
  button.disabled = false;
  if (result.ok) $('#account-dialog').close();
  else $('#account-error').textContent = result.error;
});
$('#edit-account-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  const result = await call(() =>
    poolside.update({
      id: $('#edit-account-id').value,
      name: $('#edit-account-name').value,
      role: $('#edit-account-role').value,
      note: $('#edit-account-note').value
    })
  );
  button.disabled = false;
  if (result.ok) $('#edit-account-dialog').close();
  else $('#edit-account-error').textContent = result.error;
});
async function saveAccountPreferences(reset = false) {
  const values = {};
  if (!reset) {
    for (const control of $('#account-preferences-fields').querySelectorAll('[data-path]')) {
      values[control.dataset.path] = control.type === 'checkbox' ? String(control.checked) : control.value;
    }
  }
  const result = await call(() =>
    poolside.saveAccountPreferences({
      id: $('#account-preferences-id').value,
      values,
      routePresetId: reset ? '' : $('#account-route-preset').value,
      reset
    })
  );
  if (!result.ok) return;
  const verdict = result.value;
  if (verdict.form) accountPreferencesForm = verdict.form;
  const errors = {};
  for (const problem of verdict.errors || []) if (problem.path) errors[problem.path] = problem.message;
  paintAccountPreferences(errors);
  if (!verdict.saved) {
    $('#account-preferences-status').textContent = 'Not saved. Correct the marked field.';
    const invalid = $('#account-preferences-fields').querySelector('[aria-invalid="true"]');
    if (invalid) invalid.focus();
    return;
  }
  $('#account-preferences-status').textContent = reset ? 'Workspace defaults will be used for this account.' : 'Session preferences saved.';
}
$('#account-preferences-form').addEventListener('submit', async event => {
  event.preventDefault();
  await saveAccountPreferences();
});
$('#reset-account-preferences').addEventListener('click', () => saveAccountPreferences(true));
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
// Trying an address before it is saved: the answer appears under the field, in words.
$('#route-preset-test').addEventListener('click', async () => {
  const spec = $('#route-preset-spec').value.trim();
  const output = $('#route-preset-test-result');
  if (!spec) {
    output.textContent = 'Paste an address first.';
    return;
  }
  output.textContent = 'Testing… this takes a few seconds.';
  const result = await poolside.testRoute(spec);
  output.textContent = result.ok ? result.value.message : result.error;
});
$('#route-preset-form').addEventListener('submit', async event => {
  event.preventDefault();
  const result = await call(() =>
    poolside.addRoutePreset({
      name: $('#route-preset-name').value,
      spec: $('#route-preset-spec').value,
      bypass: $('#route-preset-bypass').value,
      enabled: $('#route-preset-enabled').checked
    })
  );
  if (result.ok) $('#route-preset-form').reset();
});
$('#route-preset-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-route-preset-delete]');
  if (!button) return;
  const result = await call(() => poolside.deleteRoutePreset(button.dataset.routePresetDelete));
  if (result.ok) toast('Saved route preset removed.');
});
// A tick box is an assignment, not a preference: it takes effect on that account's next load, and the
// refreshed snapshot redraws every box so the list can never disagree with what is stored.
$('#route-preset-list').addEventListener('change', async event => {
  const box = event.target.closest('[data-route-preset-assign]');
  if (!box) return;
  box.disabled = true;
  const result = await call(() =>
    poolside.assignRoutePreset({ id: box.dataset.routeAccount, presetId: box.checked ? box.dataset.routePresetAssign : '' })
  );
  if (!result.ok) {
    box.checked = !box.checked;
    box.disabled = false;
  }
});
$('#activity-filter').addEventListener('change', event => {
  activityFilter = event.target.value;
  render(state);
});
$('#open-all').addEventListener('click', () => call(() => poolside.openAll()));
$('#close-all').addEventListener('click', () => call(() => poolside.closeAll()));
$('#arrange').addEventListener('click', () => call(() => poolside.arrange()));
$('#search').addEventListener('input', renderAccounts);
$('#select-toggle').addEventListener('click', () => setSelectionMode(!managerSelectionMode));
$('#bulk-all').addEventListener('click', () => {
  for (const account of state.accounts) managerSelection.add(account.id);
  renderManagedAccounts();
});
$('#bulk-clear').addEventListener('click', () => {
  managerSelection.clear();
  renderManagedAccounts();
});
$('#managed-accounts').addEventListener('change', event => {
  const picker = event.target.closest('[data-select-account]');
  if (!picker) return;
  if (picker.checked) managerSelection.add(picker.dataset.selectAccount);
  else managerSelection.delete(picker.dataset.selectAccount);
  renderBulkBar();
});

let captureLab = { samples: [], states: [], tables: [] };
const captureLabel = value => String(value || 'unavailable').replaceAll('-', ' ');
const capturePercent = value => (Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—');
const captureDuration = value => (Number.isFinite(value) ? `${Math.round(value)} ms` : '—');
function captureMetrics(evaluation) {
  const reviewNeeded = Math.max(0, Number(evaluation.reviewNeeded) || 0);
  return [
    ['Samples', evaluation.samples],
    [
      'Evidence samples',
      evaluation.evidenceSamples || 0,
      null,
      `${evaluation.labelsReady || 0}/${evaluation.labelsAvailable || 0} screen labels covered`
    ],
    ['Benchmark', evaluation.benchmark?.samples || 0],
    ['Benchmark match', capturePercent(evaluation.benchmark?.agreement)],
    ['Benchmark F1', capturePercent(evaluation.benchmark?.macroF1)],
    ['Capture median', captureDuration(evaluation.timing?.surface?.medianMs)],
    ['OCR median', captureDuration(evaluation.timing?.recognition?.medianMs)],
    ['Review needed', reviewNeeded, reviewNeeded > 0 ? 'review' : null]
  ]
    .map(([label, value, action, detail]) =>
      action
        ? `<button class="capture-metric actionable" type="button" data-capture-filter="${action}"><span>${label}</span><strong>${escapeHtml(value)}</strong><small>Open queue</small></button>`
        : `<div class="capture-metric"><span>${label}</span><strong>${escapeHtml(value)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</div>`
    )
    .join('');
}
function captureBenchmarkReport(evaluation) {
  const benchmark = evaluation.benchmark || {};
  if (!benchmark.samples)
    return '<p class="muted capture-report-empty">No benchmark samples yet. Set aside a reviewed, non-sensitive capture to begin a separate local check.</p>';
  const rows = (benchmark.labels || [])
    .filter(label => label.recall !== null || label.precision !== null)
    .map(
      label =>
        `<tr><th scope="row">${escapeHtml(captureLabel(label.expectedState))}</th><td>${label.truePositive + label.falseNegative}</td><td>${label.truePositive}/${label.truePositive + label.falseNegative}</td><td>${capturePercent(label.precision)}</td><td>${capturePercent(label.recall)}</td><td>${capturePercent(label.f1)}</td></tr>`
    )
    .join('');
  const summary = `Based on ${benchmark.samples} separate benchmark sample${benchmark.samples === 1 ? '' : 's'}; unrecognized rate ${capturePercent(benchmark.unrecognized)}.`;
  return rows
    ? `<div class="capture-report"><p>${escapeHtml(summary)}</p><table><thead><tr><th>Screen label</th><th>Samples</th><th>Detected</th><th>Precision</th><th>Recall</th><th>F1</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<p class="muted capture-report-empty">${escapeHtml(summary)} No recognized label has enough data for per-label measures yet.</p>`;
}
function captureValidationReport(evaluation) {
  const validation = evaluation.validation;
  if (!validation) return '<p class="muted capture-report-empty">Validation gate is unavailable.</p>';
  const status = validation.ready ? 'Ready for the production corpus gate.' : 'Not ready for the production corpus gate.';
  const gates = (validation.gates || [])
    .map(
      item =>
        `<li class="${item.pass ? 'passed' : 'failed'}"><span aria-hidden="true">${item.pass ? '✓' : '×'}</span><div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></div></li>`
    )
    .join('');
  return `<div class="capture-validation ${validation.ready ? 'ready' : 'not-ready'}"><p><strong>${escapeHtml(status)}</strong> ${validation.passedGates} of ${validation.totalGates} checks pass. This is the held-out Benchmark gate; saved Evidence images do not count toward its per-table minimum.</p><ul>${gates}</ul></div>`;
}
function filteredCaptureSamples() {
  const expectedState = $('#capture-filter-state').value;
  const cohort = $('#capture-filter-cohort').value;
  const result = $('#capture-filter-result').value;
  return captureLab.samples.filter(sample => {
    if (expectedState && sample.expectedState !== expectedState) return false;
    if (cohort && sample.cohort !== cohort) return false;
    if (result === 'review' && (sample.matches || sample.reviewedAt)) return false;
    if (result === 'match' && !sample.matches) return false;
    return true;
  });
}
function populateCaptureFilters() {
  const filter = $('#capture-filter-state');
  const selected = filter.value;
  filter.innerHTML = `<option value="">All screen labels</option>${(captureLab.states || [])
    .map(value => `<option value="${escapeHtml(value)}">${escapeHtml(captureLabel(value))}</option>`)
    .join('')}`;
  if ((captureLab.states || []).includes(selected)) filter.value = selected;
}
function captureCoverage(evaluation) {
  return evaluation.labels
    .map(label => {
      const sampleNoun = `sample${label.count === 1 ? '' : 's'}`;
      const detail =
        label.evidenceStatus === 'ready'
          ? `${label.count} ${sampleNoun} · ${label.matches}/${label.count} detector matches · ${label.reviewNeeded || 0} need review`
          : label.count
            ? `${label.count} ${sampleNoun} · ${label.matches}/${label.count} detector matches · needs ${label.samplesNeeded} more · ${label.reviewNeeded || 0} need review`
            : `Needs ${label.samplesNeeded || evaluation.minimumEvidencePerLabel || 1} distinct samples`;
      return `<div class="capture-coverage-row ${label.evidenceStatus || (label.count ? 'limited' : 'missing')}"><span>${escapeHtml(captureLabel(label.expectedState))}</span><strong>${escapeHtml(detail)}</strong></div>`;
    })
    .join('');
}
function captureTableCoverage(evaluation) {
  const evidence = evaluation.evidenceMetrics?.tables || [];
  const benchmark = new Map((evaluation.benchmark?.tables || []).map(item => [item.table, item]));
  if (!evidence.length) return '<p class="muted">No supported table labels are available.</p>';
  return evidence
    .map(item => {
      const heldOut = benchmark.get(item.table) || { count: 0, matches: 0 };
      const evidenceResult = item.count
        ? `Evidence: ${item.count} images · ${item.matches}/${item.count} identified at capture`
        : 'Evidence: no images';
      const benchmarkResult = heldOut.count
        ? `Benchmark: ${heldOut.count} held-out images · ${heldOut.matches}/${heldOut.count} identified`
        : 'Benchmark: no held-out images yet';
      const readiness = item.count >= 3 ? 'ready' : item.count ? 'limited' : 'missing';
      return `<div class="capture-coverage-row ${readiness}"><span>${escapeHtml(item.table)}</span><strong>${escapeHtml(evidenceResult)} · ${escapeHtml(benchmarkResult)}</strong></div>`;
    })
    .join('');
}
function syncCaptureTableField() {
  const needsTable = $('#capture-state').value === 'table-selection';
  const tableField = $('#capture-table-field');
  const tableSelect = $('#capture-table');
  tableField.hidden = !needsTable;
  tableSelect.disabled = !needsTable;
  tableSelect.required = needsTable;
  if (!needsTable) tableSelect.value = '';
}
function renderCaptureLab() {
  const select = $('#capture-account');
  const selectedAccount = select.value;
  const open = state.accounts.filter(account => !isClosed(account));
  select.innerHTML = open.length
    ? open.map(account => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}</option>`).join('')
    : '<option value="">Open a game window first</option>';
  if (open.some(account => account.id === selectedAccount)) select.value = selectedAccount;
  select.disabled = !open.length;
  const stateSelect = $('#capture-state');
  const selectedState = stateSelect.value;
  stateSelect.innerHTML = (captureLab.states || [])
    .map(value => `<option value="${escapeHtml(value)}">${escapeHtml(captureLabel(value))}</option>`)
    .join('');
  if (captureLab.states.includes(selectedState)) stateSelect.value = selectedState;
  const tableSelect = $('#capture-table');
  const selectedTable = tableSelect.value;
  tableSelect.innerHTML =
    '<option value="">Choose a table…</option>' +
    (captureLab.tables || []).map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  if ((captureLab.tables || []).includes(selectedTable)) tableSelect.value = selectedTable;
  syncCaptureTableField();
  const evaluation = captureLab.evaluation || {
    samples: captureLab.samples.length,
    labelsWithEvidence: 0,
    labelsAvailable: 0,
    labelsReady: 0,
    minimumEvidencePerLabel: 3,
    agreement: null,
    disagreements: 0,
    benchmark: { samples: 0, agreement: null },
    labels: []
  };
  populateCaptureFilters();
  $('#capture-count').textContent = evaluation.samples;
  $('#capture-metrics').innerHTML = captureMetrics(evaluation);
  $('#capture-coverage').innerHTML = captureCoverage(evaluation);
  $('#capture-table-coverage').innerHTML = captureTableCoverage(evaluation);
  $('#capture-validation-report').innerHTML = captureValidationReport(evaluation);
  $('#capture-benchmark-report').innerHTML = captureBenchmarkReport(evaluation);
  const samples = filteredCaptureSamples();
  $('#capture-visible-count').textContent = `${samples.length} of ${captureLab.samples.length} shown`;
  $('#capture-samples').innerHTML = samples.length
    ? samples
        .map(
          sample =>
            `<article class="managed-card"><div class="managed-card-heading"><div><div class="account-name">${escapeHtml(captureLabel(sample.expectedState))}${sample.expectedTable ? ` · ${escapeHtml(sample.expectedTable)}` : ''}</div><span class="account-role">Expected screen · ${escapeHtml(new Date(sample.capturedAt).toLocaleString())}</span></div><div class="capture-sample-actions"><button class="secondary" data-capture-action="preview" data-id="${sample.id}" ${sample.imageAvailable ? '' : 'disabled'}>View image</button>${!sample.matches && !sample.reviewedAt ? `<button class="secondary" data-capture-action="mark-reviewed" data-id="${sample.id}">Mark reviewed</button>` : ''}<button class="secondary" data-capture-action="set-cohort" data-id="${sample.id}" data-cohort="${sample.cohort === 'benchmark' ? 'evidence' : 'benchmark'}">${sample.cohort === 'benchmark' ? 'Use as evidence' : 'Set aside'}</button><button class="danger-button" data-capture-action="delete" data-id="${sample.id}">Delete…</button></div></div><dl class="managed-details"><div><dt>Detector result</dt><dd>${escapeHtml(captureLabel(sample.observedState))} · ${Math.round(Number(sample.score || 0) * 100)}%</dd></div>${sample.expectedTable ? `<div><dt>Expected table</dt><dd>${escapeHtml(sample.expectedTable)}</dd></div><div><dt>Detected table</dt><dd>${sample.observedTables?.length ? escapeHtml(sample.observedTables.join(', ')) : 'No supported table name detected'}</dd></div>` : ''}<div><dt>Review</dt><dd>${sample.matches ? 'OCR matched your label and table target' : sample.reviewedAt ? `Reviewed ${new Date(sample.reviewedAt).toLocaleDateString()}` : 'Needs your decision'}</dd></div><div><dt>Capture set</dt><dd>${sample.cohort === 'benchmark' ? 'Benchmark' : 'Evidence'}</dd></div><div><dt>Capture size</dt><dd>${sample.width && sample.height ? `${sample.width} × ${sample.height}` : 'Unavailable'}</dd></div><div><dt>Timing</dt><dd>${sample.timing ? `Capture ${captureDuration(sample.timing.surfaceMs)} · OCR ${captureDuration(sample.timing.recognitionMs)} · Total ${captureDuration(sample.timing.totalMs)}` : 'Not measured'}</dd></div><div><dt>OCR pass</dt><dd>${escapeHtml(sample.source || 'unavailable')}</dd></div></dl></article>`
        )
        .join('')
    : `<div class="manager-empty">${captureLab.samples.length ? 'No samples match the current filters.' : 'No local samples yet. Open a game window and capture a screen you have labeled.'}</div>`;
}
async function loadCaptureLab() {
  const result = await call(() => poolside.captureList());
  if (!result.ok) return;
  captureLab = result.value;
  renderCaptureLab();
}
async function openCapturePreview(id) {
  const result = await call(() => poolside.captureImage(id));
  if (!result.ok) return;
  const sample = captureLab.samples.find(entry => entry.id === id);
  $('#capture-preview-title').textContent = `${captureLabel(sample?.expectedState)} sample`;
  $('#capture-preview-detail').textContent =
    `Expected ${captureLabel(sample?.expectedState)}${sample?.expectedTable ? ` for ${sample.expectedTable}` : ''}; detected ${captureLabel(sample?.observedState)}${sample?.observedTables?.length ? ` with ${sample.observedTables.join(', ')} visible` : ''} at ${Math.round(Number(sample?.score || 0) * 100)}%.`;
  $('#capture-preview-image').src = `data:image/png;base64,${result.value.png}`;
  showDialog('#capture-preview-dialog', '#cancel-capture-preview');
}
$('#capture-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $('#capture-status').textContent = 'Capturing and evaluating locally…';
  const result = await call(() =>
    poolside.captureRecord({
      id: $('#capture-account').value,
      expectedState: $('#capture-state').value,
      expectedTable: $('#capture-state').value === 'table-selection' ? $('#capture-table').value : null,
      cohort: $('#capture-benchmark').checked ? 'benchmark' : 'evidence',
      confirmedSafe: $('#capture-confirmed').checked
    })
  );
  button.disabled = false;
  if (!result.ok) {
    $('#capture-status').textContent = 'No sample was saved.';
    return;
  }
  $('#capture-status').textContent =
    `Saved. Detector reported ${captureLabel(result.value.state)} at ${Number.isFinite(result.value.score) ? Math.round(result.value.score * 100) + '%' : 'an unavailable confidence'}.`;
  $('#capture-confirmed').checked = false;
  $('#capture-benchmark').checked = false;
  $('#capture-table').value = '';
  await loadCaptureLab();
});
$('#capture-state').addEventListener('change', syncCaptureTableField);
$('#capture-metrics').addEventListener('click', event => {
  const button = event.target.closest('button[data-capture-filter]');
  if (!button) return;
  $('#capture-filter-result').value = button.dataset.captureFilter;
  renderCaptureLab();
  document.querySelector('.capture-samples')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#capture-samples').addEventListener('click', async event => {
  const button = event.target.closest('button[data-capture-action]');
  if (!button || button.disabled) return;
  event.stopPropagation();
  if (button.dataset.captureAction === 'preview') return openCapturePreview(button.dataset.id);
  if (button.dataset.captureAction === 'mark-reviewed') {
    const result = await call(() => poolside.captureReview(button.dataset.id));
    if (result.ok) {
      toast('Sample marked as reviewed.');
      await loadCaptureLab();
    }
    return;
  }
  if (button.dataset.captureAction === 'set-cohort') {
    const result = await call(() => poolside.captureSetCohort({ id: button.dataset.id, cohort: button.dataset.cohort }));
    if (result.ok) await loadCaptureLab();
    return;
  }
  const result = await call(() => poolside.captureDelete(button.dataset.id));
  if (result.ok) {
    toast('The local capture image and its record were deleted.');
    await loadCaptureLab();
  }
});
for (const id of ['capture-filter-state', 'capture-filter-cohort', 'capture-filter-result']) {
  $(`#${id}`).addEventListener('change', () => renderCaptureLab());
}
$('#cancel-capture-preview').addEventListener('click', () => $('#capture-preview-dialog').close());
