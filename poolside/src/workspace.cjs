// The data layer: the persisted workspace document, the activity feed, and the snapshot the
// dashboard renders. Extracted from main.cjs so the composition root is wiring, not storage.

const fs = require('node:fs');
const path = require('node:path');
const model = require('./model.cjs');
const { messageOf } = require('./errors.cjs');
const { events, sessions, workspace, profileReports } = require('./state.cjs');

const MAX_EVENTS = 100;

/**
 * Record an activity entry and push a fresh snapshot to the dashboard.
 * @param {string} message
 * @param {'info'|'warning'} [kind]
 */
function log(message, kind = 'info') {
  events.unshift({ id: Date.now() + Math.random(), at: new Date().toISOString(), message, kind });
  events.splice(MAX_EVENTS);
  publish();
}

/**
 * One account's profile picture for the dashboard: the durable bookkeeping (generation, corruption
 * history) merged with the live measurement taken by the last scan. Returns null when there is nothing
 * to say, so the renderer can distinguish "not measured yet" from "measured and unremarkable".
 * @param {import('./types.cjs').Account} account
 * @returns {import('./types.cjs').ProfileView|null}
 */
function profileView(account) {
  const persisted = account.profile || {};
  const live = profileReports.get(account.id) || {};
  return Object.keys(persisted).length || Object.keys(live).length ? { ...persisted, ...live } : null;
}

/**
 * The dashboard-facing view of the workspace: accounts with their live session state.
 * @returns {{accounts: object[], settings: import('./types.cjs').WorkspaceSettings, events: import('./types.cjs').ActivityEvent[], readOnly: boolean, version: string}}
 */
function snapshot() {
  return {
    accounts: workspace.data.accounts
      .filter(a => !a.archived)
      .map(a => {
        const group = sessions.get(a.id);
        return {
          ...a,
          // A session with no group is closed: `closed` is a state, not a stored one.
          status: group && group.fsm ? group.fsm.state : 'closed',
          statusReason: group && group.fsm ? group.fsm.reason : null,
          health: group && group.health ? group.health : null,
          footprint: group && group.footprint ? group.footprint : null,
          profile: profileView(a),
          network: group && group.network ? group.network : null,
          gameScreen: group && group.gameScreen ? group.gameScreen : null
        };
      }),
    settings: workspace.data.settings,
    events,
    readOnly: workspace.readOnly,
    version: workspace.version
  };
}

/** Push the current snapshot to the dashboard, if it is open. */
function publish() {
  const dashboard = workspace.dashboard;
  if (dashboard && !dashboard.isDestroyed()) dashboard.webContents.send('workspace:changed', snapshot());
}

/**
 * Persist the workspace atomically, then publish.
 * @param {import('./types.cjs').WorkspaceData} next
 */
function save(next) {
  if (workspace.readOnly)
    throw new Error('Workspace data could not be read. Restart after fixing the workspace file; existing data has not been overwritten.');
  if (!workspace.storeFile) throw new Error('The workspace file is not initialised yet.');
  fs.mkdirSync(path.dirname(workspace.storeFile), { recursive: true });
  fs.writeFileSync(workspace.storeFile + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(workspace.storeFile + '.tmp', workspace.storeFile);
  workspace.data = next;
  publish();
}

/**
 * @param {string} id
 * @returns {import('./types.cjs').Account}
 */
function getAccount(id) {
  const account = workspace.data.accounts.find(a => a.id === id && !a.archived);
  if (!account) throw new Error('Account not found.');
  return account;
}

/**
 * Where this account's window was last left, or null.
 * @param {string} id
 */
function savedWindowGeometry(id) {
  const windows = workspace.data.windows;
  return windows && windows[id] ? windows[id] : null;
}

/**
 * Remember where a session window was left.
 *
 * Never throws: window geometry is disposable, and losing a rectangle must not be able to fail an
 * operation the user actually asked for. A read-only workspace or a failed write is logged and
 * otherwise ignored.
 * @param {string} id
 * @param {object} record
 */
function rememberWindowGeometry(id, record) {
  if (workspace.readOnly) return false;
  try {
    save({ ...workspace.data, windows: { ...(workspace.data.windows || {}), [id]: record } });
    return true;
  } catch (error) {
    log(`Window position could not be saved: ${messageOf(error)}`, 'warning');
    return false;
  }
}

/**
 * Merge a patch into one account's persisted profile bookkeeping, or clear it with `null`.
 *
 * Never throws. This is bookkeeping *about* a profile, and losing a counter must not be able to fail the
 * operation that triggered it — the same reasoning as remembered window geometry.
 * @param {string} id @param {object|null} patch
 */
function updateAccountProfile(id, patch) {
  if (workspace.readOnly) return false;
  try {
    const accounts = workspace.data.accounts.map(account => {
      if (account.id !== id) return account;
      if (patch === null) {
        const cleared = { ...account };
        delete cleared.profile;
        return cleared;
      }
      return { ...account, profile: { ...(account.profile || {}), ...patch } };
    });
    save({ ...workspace.data, accounts });
    return true;
  } catch (error) {
    log(`Profile bookkeeping could not be saved: ${messageOf(error)}`, 'warning');
    return false;
  }
}

/**
 * Load the workspace document. A malformed file flips the app to read-only rather than
 * overwriting data the user may still want.
 * @param {string} file
 */
function load(file) {
  workspace.storeFile = file;
  if (!fs.existsSync(file)) return;
  try {
    workspace.data = model.decode(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    workspace.readOnly = true;
    log('Workspace file could not be read. Existing data was preserved.', 'warning');
  }
}

module.exports = {
  log,
  snapshot,
  publish,
  save,
  getAccount,
  load,
  savedWindowGeometry,
  rememberWindowGeometry,
  updateAccountProfile,
  profileView,
  MAX_EVENTS
};
