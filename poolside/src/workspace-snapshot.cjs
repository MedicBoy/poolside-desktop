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
const { view: runsView } = require('./run-coordination.cjs');
const { statusFor } = require('./run-status.cjs');
const contrast = require('./participant-contrast.cjs');
const attention = require('./attention.cjs');
const guidance = require('./guidance.cjs');
const { participantReady } = require('./match-service.cjs');
const { participantPreflight } = require('./match-preflight.cjs');

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
  const target = footprint.target;
  return {
    summary: typeof footprint.summary === 'string' ? footprint.summary : null,
    route: route ? { configured: route.configured === true, label: String(route.label || '') } : null,
    // Anything the browser refused, named by the field it belongs to, so the row can say which control to fix
    // rather than leaving a session that is not what the operator configured with no explanation.
    refused: Array.isArray(target?.refused)
      ? target.refused.map(entry => ({
          field: String(entry.field || 'A field'),
          value: String(entry.value ?? ''),
          error: String(entry.error || '')
        }))
      : [],
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
    // Which saved network location this account connects from, so the settings list can tick the right
    // box. An id, never the address itself — the credentials stay in the main process.
    ...(typeof account.routePresetId === 'string' && account.routePresetId ? { routePresetId: account.routePresetId } : {}),
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
  const preflight = participantPreflight({ open, status: session, footprint: group ? group.footprint : null });
  // Which saved location this account is pointed at, **by name** — never its address, which stays in the main
  // process. A name is what a record needs: "which of my two exits was this?" is answered by "London-2", and an
  // address in a document that can be sent on is what the export rules exist to prevent.
  const account = (workspace.data.accounts || []).find(candidate => candidate.id === participant.id);
  const preset = account ? (workspace.data.routePresets || []).find(item => item.id === account.routePresetId) : null;
  return {
    ...participant,
    open,
    session,
    ready: participantReady({ open, status: session }),
    route: preflight.route,
    location: preset && typeof preset.name === 'string' ? preset.name : null,
    detail: preflight.detail,
    releasable: preflight.ok
  };
}

/**
 * A session's WebRTC policy, or null when there is no live window to ask.
 *
 * The snapshot is built on every state change — while windows are opening and closing — so a window that
 * has gone between two lines must read as "no window" rather than throwing out of the snapshot and taking
 * whatever asked for it down with it.
 * @param {{window?: any}|null|undefined} group
 */
function webRTCPolicyOf(group) {
  try {
    const window = group && group.window;
    if (!window || typeof window.isDestroyed !== 'function' || window.isDestroyed()) return null;
    const contents = window.webContents;
    if (!contents || contents.isDestroyed()) return null;
    return contents.getWebRTCIPHandlingPolicy();
  } catch {
    return null;
  }
}

function matchesView() {
  // Every snapshot is also a look at the world: the coordinator reconciles the ledger first — a window that
  // has closed, an account that has gone, a plan that has run out of time — so what the dashboard shows is
  // what is actually true, not what was true when the operator last pressed something. The refresh publishes
  // only when something changed, so this cannot loop.
  const service = matchState.service;
  const view = service && typeof service.refresh === 'function' ? service.refresh() : dashboardView(matchState.current);
  const decorate = match => ({
    ...match,
    participants: match.participants.map(matchParticipantView),
    // The count-in lives in memory for the few seconds it lasts; what it measured goes into the match history.
    release: service && typeof service.releaseStatus === 'function' ? service.releaseStatus(match.matchId) : null,
    // What the two accounts are *configured* to look like, said next to the verdict. Derived on every snapshot
    // from the workspace, so it cannot go stale, and it reports configuration rather than observation.
    contrast: contrast.notes({
      participants: match.participants,
      accounts: workspace.data.accounts,
      routePresets: workspace.data.routePresets || []
    })
  });
  const runs = view.runs || runsView(matchState.current);
  const decorateRun = run => {
    const decorated = {
      ...run,
      participants: run.participants.map(participant => ({
        ...matchParticipantView(participant),
        role: participant.role,
        // What that session is showing, so the run card can say whether the target table is in front of the
        // operator. Advisory: nothing about release is gated on it.
        screen: runScreenView(participant.id, run.plan.table)
      }))
    };
    // Where the run is and what to do next, derived from the run, the match in progress under it and the
    // ages of the readings it rests on. Derived rather than stored, so it cannot disagree with them.
    const under = view.active.find(match => match.runId === run.runId);
    return { ...decorated, status: statusFor({ run: decorated, match: under ? decorate(under) : null, now: Date.now() }) };
  };
  return {
    ...view,
    active: view.active.map(decorate),
    recent: view.recent.map(decorate),
    runs: {
      active: runs.active ? decorateRun(runs.active) : null,
      recent: runs.recent.map(decorateRun)
    }
  };
}

/**
 * The run's target table as the session reports it. Null when there is no reading at all, which is a
 * different answer from "the reading does not show the table yet".
 * @param {string} id @param {string} targetTable
 */
function runScreenView(id, targetTable) {
  const group = sessions.get(id);
  const screen = group && group.gameScreen ? group.gameScreen : null;
  if (!screen || typeof screen !== 'object') return null;
  const tables = Array.isArray(screen.visibleTables) ? screen.visibleTables : [];
  // "Identified" means the local visual matcher recognised this table's own screen from reviewed Evidence.
  // The list of names on a table-selection screen is a weaker fact and is reported as its own field, because
  // "Rome is listed" and "Rome is the table you are on" are not the same statement.
  return {
    state: typeof screen.state === 'string' ? screen.state : null,
    observedAt: screen.observedAt || null,
    identified: Boolean(screen.tableMatch && screen.tableMatch.table === targetTable),
    listed: tables.includes(targetTable)
  };
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
      // The session's own WebRTC policy, so the row that explains a session's network can say whether
      // anything is still able to step around the route. Null when there is no live window to ask.
      webRTC: webRTCPolicyOf(group),
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
  // Everything that needs the operator's attention, in one list. Derived from the same snapshot the dashboard
  // reads, so it cannot describe a state the panels below are not showing.
  // Built once: the match view reconciles the ledger on the way in, so asking for it twice would do that work
  // twice and publish twice for one snapshot.
  const matches = matchesView();
  const attentionItems = attention.items({ accounts, readOnly: workspace.readOnly, matches });
  // What to do next, but only while there is nothing wrong: two panels telling the operator what to do at the
  // same time is one panel too many, and a problem outranks getting started.
  const guide = guidance.forWorkspace({ accounts });
  return {
    accounts,
    archivedAccounts,
    attention: { items: attentionItems, summary: attention.summary(attentionItems) },
    guidance: attentionItems.length ? { ...guide, show: false } : guide,
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
    matches
  };
}

module.exports = {
  buildSnapshot,
  profileView,
  footprintView,
  runScreenView,
  publicAccount,
  publicSettings,
  tableNavigationView,
  matchesView,
  matchParticipantView,
  TIMELINE_VIEW_LIMIT
};
