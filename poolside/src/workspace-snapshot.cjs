// Build the dashboard-safe view of process and workspace state.

const dashboardTelemetry = require('./dashboard-telemetry.cjs');
const { events, sessions, workspace, profileReports, matchState } = require('./state.cjs');
const { view: timelineView } = require('./timeline-transfer.cjs');
const { buildAccountOverview } = require('./account-overview.cjs');
const { resolveRecovery } = require('./recovery-settings.cjs');
const { describeReadings } = require('./reading-status.cjs');
const { publicRoutePreset } = require('./proxy-public.cjs');
const { TABLES } = require('./table-list.cjs');
const { buildCapabilityReport } = require('./capability-registry.cjs');
const { dashboardView } = require('./match-coordination.cjs');
const { participantReady } = require('./match-service.cjs');

/** Bounded because snapshots are broadcast on every state change. */
const TIMELINE_VIEW_LIMIT = 100;

/** @param {import('./types.cjs').Account} account @returns {import('./types.cjs').ProfileView|null} */
function profileView(account) {
  const persisted = account.profile || {};
  const live = profileReports.get(account.id) || {};
  return Object.keys(persisted).length || Object.keys(live).length ? { ...persisted, ...live } : null;
}

/** Keep runtime-only credentials and raw route configuration on the main-process side of IPC. */
function footprintView(footprint) {
  if (!footprint || typeof footprint !== 'object') return null;
  const route = footprint.route;
  const verified = footprint.verified;
  const storage = footprint.storage;
  return {
    summary: typeof footprint.summary === 'string' ? footprint.summary : null,
    route: route ? { configured: route.configured === true, label: String(route.label || '') } : null,
    verified:
      verified && verified.ok === true
        ? { ok: true, matches: verified.matches === true, route: { label: String(verified.route?.label || '') } }
        : null,
    storage:
      storage && typeof storage === 'object'
        ? { cacheBytes: Number.isFinite(storage.cacheBytes) ? storage.cacheBytes : null, overQuota: storage.overQuota === true }
        : null
  };
}

/** Only fields deliberately rendered by the dashboard cross IPC. */
function publicAccount(account) {
  return {
    id: account.id,
    name: account.name,
    role: account.role,
    archived: account.archived === true,
    createdAt: account.createdAt,
    ...(typeof account.note === 'string' ? { note: account.note } : {})
  };
}

function publicSettings(settings) {
  return { table: settings.table, limit: settings.limit };
}

/**
 * Each match participant's live session, so the dashboard can say who is actually loaded. The ledger
 * itself stays pure and persisted; whether a window is open is process state and is resolved here.
 * @param {{id: string, name: string}} participant
 */
function matchParticipantView(participant) {
  const group = sessions.get(participant.id);
  const open = Boolean(group && group.window && typeof group.window.isDestroyed === 'function' && !group.window.isDestroyed());
  const session = open && group && group.fsm ? group.fsm.state : 'closed';
  return { ...participant, open, session, ready: participantReady({ open, status: session }) };
}

function matchesView() {
  const view = dashboardView(matchState.current);
  const decorate = match => ({ ...match, participants: match.participants.map(matchParticipantView) });
  return { ...view, active: view.active.map(decorate), recent: view.recent.map(decorate) };
}

function tableNavigationView(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    mode: value.mode === 'dry-run' ? 'dry-run' : 'unavailable',
    targetTable: TABLES.includes(value.targetTable) ? value.targetTable : null,
    state: typeof value.state === 'string' ? value.state : 'failed',
    retryCount: Number.isInteger(value.retryCount) ? value.retryCount : 0,
    startedAt: value.startedAt || null,
    updatedAt: value.updatedAt || null,
    deadlineAt: value.deadlineAt || null,
    lastObservation: value.lastObservation || null,
    input: value.input
      ? { action: value.input.action || null, performed: false, instruction: String(value.input.instruction || '') }
      : null,
    history: Array.isArray(value.history) ? value.history.slice(-8) : []
  };
}

/** @param {object} activityHistory */
function buildSnapshot(activityHistory) {
  const accountView = account => {
    const group = sessions.get(account.id);
    return {
      ...publicAccount(account),
      status: group && group.fsm ? group.fsm.state : 'closed',
      statusReason: group && group.fsm ? group.fsm.reason : null,
      health: group && group.health ? group.health : null,
      footprint: group && group.footprint ? footprintView(group.footprint) : null,
      profile: profileView(account),
      network: group && group.network ? group.network : null,
      gameScreen: group && group.gameScreen ? group.gameScreen : null,
      visibleReadings: describeReadings(group && group.visibleReadings ? group.visibleReadings : {}, Date.now()),
      monitoring: Boolean(group && group.monitoring),
      monitorIntervalSeconds: resolveRecovery(account).monitorIntervalSeconds,
      screenHistory: group && Array.isArray(group.screenHistory) ? group.screenHistory : [],
      screenAttention: group && group.screenAttention?.message ? group.screenAttention : null,
      tableNavigation: tableNavigationView(group && group.tableNavigation),
      overview: buildAccountOverview(
        account,
        { ...workspace.data.settings, routePresets: workspace.data.routePresets || [] },
        group || null
      )
    };
  };
  const accounts = workspace.data.accounts.filter(account => !account.archived).map(accountView);
  const archivedAccounts = workspace.data.accounts.filter(account => account.archived).map(accountView);
  const timelines = workspace.data.accounts
    .map(account => {
      const group = sessions.get(account.id);
      return group && group.fsm ? { id: account.id, name: account.name, transitions: group.fsm.history() } : null;
    })
    .filter(Boolean);
  const compiled = timelineView({ sessions: timelines, events, limit: TIMELINE_VIEW_LIMIT });
  return {
    accounts,
    archivedAccounts,
    settings: publicSettings(workspace.data.settings),
    tables: TABLES,
    routePresets: (workspace.data.routePresets || []).map(publicRoutePreset),
    events,
    activityHistory,
    timeline: compiled,
    telemetry: dashboardTelemetry.build(accounts, { version: workspace.version, timeline: compiled }),
    readOnly: workspace.readOnly,
    version: workspace.version,
    capabilityReport: buildCapabilityReport(workspace.version),
    // Local match coordination: totals, the matches in progress with their live sessions, and the
    // most recent results.
    matches: matchesView()
  };
}

module.exports = {
  buildSnapshot,
  profileView,
  footprintView,
  publicAccount,
  publicSettings,
  tableNavigationView,
  matchesView,
  matchParticipantView,
  TIMELINE_VIEW_LIMIT
};
