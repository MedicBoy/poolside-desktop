// Shared process-lifetime state.
//
// Kept in one deliberately tiny module so the feature modules can reach genuinely global state
// without requiring each other, which would create cycles (windows -> recovery -> windows).

/** @typedef {Map<string, import('./types.cjs').SessionGroup>} SessionMap */

/** @type {SessionMap} */
const sessions = new Map();

/** @type {import('./types.cjs').ActivityEvent[]} */
const events = [];

const workspace = {
  /** @type {import('./types.cjs').WorkspaceData} */
  data: { version: 1, accounts: [], settings: { table: 'Bangkok', limit: 10 } },
  readOnly: false,
  /** @type {string|null} */
  storeFile: null,
  /** @type {import('electron').BrowserWindow|null} */
  dashboard: null,
  /** @type {string} */
  version: '0.0.0'
};

module.exports = { sessions, events, workspace };
