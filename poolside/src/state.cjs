// Shared process-lifetime state.
//
// Kept in one deliberately tiny module so the feature modules can reach genuinely global state
// without requiring each other, which would create cycles (windows -> recovery -> windows).
//
// Two layers of per-account session state exist, with deliberately different lifetimes. Both are
// declared here so there is exactly one place to look for "where does session state live":
//
//   sessions      — the live window and what has been observed about it. An entry disappears when
//                   its window closes.
//   sessionStores — the saved-session queue for that account. It outlives the window, because a
//                   save is debounced and must still flush if the user closes a window and quits
//                   straight away.
//
// The authority for cookie *data* is neither of these: it is the Chromium profile, per ADR-004.

const { emptyState } = require('./match-coordination.cjs');

/** @typedef {Map<string, import('./types.cjs').SessionGroup>} SessionMap */

/** @type {SessionMap} */
const sessions = new Map();

/**
 * Per-account profile diagnostics: what the profile occupies on disk and how that compares with its
 * configured ceiling.
 *
 * Deliberately **not** persisted, unlike the generation counter and corruption history in the workspace
 * document. These are re-derived on every scan, and writing the whole workspace document every time a
 * directory is measured would be churn for no gain.
 * @type {Map<string, import('./types.cjs').ProfileReport>}
 */
const profileReports = new Map();

/** @type {import('./types.cjs').ActivityEvent[]} */
const events = [];

/**
 * Saved-session store per account id, created on first open and never removed while the app runs.
 * @type {Map<string, import('./types.cjs').ProfileStore>}
 */
const sessionStores = new Map();

/**
 * The local match ledger. Owned by `match-service.cjs`, which is its only writer, and read by the
 * dashboard snapshot so a match appears and settles while the app is running. It is held here rather
 * than in the workspace document because a match belongs to two accounts and to a session in progress,
 * not to one account record — and because that document's schema is a release artifact of its own.
 *
 * The composition root also attaches the coordinator itself as `service`, so the snapshot can ask it to
 * reconcile the ledger before reading it: a window that has closed, an account that has gone or a plan that
 * has run out of time are all things the ledger has to catch up with, and a snapshot is taken far more often
 * than the operator presses anything. Absent until it is filled in, so a startup snapshot still works.
 * @type {{current: {format: string, sequence: number, matches: any[]}, service?: any}}
 */
const matchState = { current: emptyState() };

const workspace = {
  /** @type {import('./types.cjs').WorkspaceData} */
  data: { version: 1, accounts: [], settings: { table: 'Bangkok', limit: 10 } },
  readOnly: false,
  // Orphan removal is allowed only after a complete workspace document was decoded or saved.
  authoritative: false,
  /** @type {string|null} */
  storeFile: null,
  /** @type {import('electron').BrowserWindow|null} */
  dashboard: null,
  /** @type {string} */
  version: '0.0.0'
};

module.exports = { sessions, events, sessionStores, workspace, profileReports, matchState };
