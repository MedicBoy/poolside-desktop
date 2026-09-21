// The persisted workspace document, activity feed, and snapshot the dashboard renders.

const fs = require('node:fs');
const model = require('./model.cjs');
const { messageOf } = require('./errors.cjs');
const { events, workspace } = require('./state.cjs');
const { createWorkspaceHistory } = require('./workspace-history.cjs');
const { buildSnapshot, profileView, TIMELINE_VIEW_LIMIT } = require('./workspace-snapshot.cjs');
const { writeWorkspace, recoveryAvailable } = require('./workspace-file.cjs');

const MAX_EVENTS = 100;

const accountNames = () => workspace.data.accounts.map(account => account.name);
const activityHistory = createWorkspaceHistory(events, MAX_EVENTS);

const configureActivityJournal = journal => activityHistory.configure(journal);
const loadActivityHistory = () => activityHistory.restore(accountNames());
const clearActivityHistory = () => {
  const result = activityHistory.clear();
  publish();
  return result;
};

/** @param {string} message @param {'info'|'warning'} [kind] */
function log(message, kind = 'info') {
  const entry = { id: Date.now() + Math.random(), at: new Date().toISOString(), message, kind };
  events.unshift(entry);
  events.splice(MAX_EVENTS);
  activityHistory.record(entry, accountNames());
  publish();
}

function snapshot() {
  return buildSnapshot(activityHistory.status());
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
  workspace.data = writeWorkspace(workspace.storeFile, next);
  workspace.authoritative = true;
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

/** Remember disposable window geometry without failing the action that triggered it. @param {string} id @param {object} record */
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
 * Merge a patch into one account's persisted profile bookkeeping, or clear it with `null`. Never throws: losing a
 * counter must not fail the operation that triggered it.
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
  workspace.authoritative = false;
  if (!fs.existsSync(file)) {
    if (recoveryAvailable(file)) {
      workspace.readOnly = true;
      log(
        'Workspace file is missing, but recovery data exists. Existing files were preserved; restore is required before editing.',
        'warning'
      );
      return { state: 'recovery-available' };
    }
    workspace.readOnly = false;
    return { state: 'missing' };
  }
  try {
    workspace.data = model.decode(JSON.parse(fs.readFileSync(file, 'utf8')));
    workspace.readOnly = false;
    workspace.authoritative = true;
    return { state: 'loaded' };
  } catch {
    workspace.readOnly = true;
    log(
      recoveryAvailable(file)
        ? 'Workspace file could not be read. A previous or staged copy exists; existing data was preserved for recovery.'
        : 'Workspace file could not be read. Existing data was preserved.',
      'warning'
    );
    return { state: 'invalid' };
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
  configureActivityJournal,
  loadActivityHistory,
  clearActivityHistory,
  profileView,
  MAX_EVENTS,
  TIMELINE_VIEW_LIMIT
};
