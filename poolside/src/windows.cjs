// Account session windows: creation, arrangement and lifecycle.
//
// The "group" shape is documented in src/types.cjs. Session policy lives in hardening.cjs, profile
// persistence in profiles.cjs, recovery supervision in recovery.cjs.

const { BrowserWindow, screen, session } = require('electron');
const savedSessions = require('./saved-session.cjs');
const { applySessionPolicy, applyNavigationPolicy } = require('./hardening.cjs');
const { createProfileStore } = require('./profiles.cjs');
const { attachRecovery } = require('./recovery.cjs');
const { tileGeometry, rectFor, WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT } = require('./layout.cjs');
const { messageOf } = require('./errors.cjs');
const { sessions } = require('./state.cjs');

const GAME_URL = 'https://8ballpool.com/game';
const GAME_WINDOW_WIDTH = 1060;
const GAME_WINDOW_HEIGHT = 800;
const CRAMPED_WIDTH = 420;

/**
 * @param {{log: import('./types.cjs').LogFn, publish: () => void, getAccount: (id: string) => import('./types.cjs').Account, selfTest: boolean}} deps
 */
function createSessionManager(deps) {
  const { log, publish, getAccount, selfTest } = deps;
  const profiles = createProfileStore({ log });

  /**
   * Navigate an existing window back to the game without losing its session.
   * @param {string} id
   * @param {boolean} [focus]
   */
  async function returnToGame(id, focus = true) {
    const account = getAccount(id);
    const group = sessions.get(id);
    if (!group || group.window.isDestroyed()) throw new Error('Open this account window first.');
    if (group.shopGate) group.shopGate.used = true;
    group.status = 'loading';
    log(`${account.name}: returning to the game using the existing session.`);
    if (!selfTest && focus) {
      group.window.show();
      group.window.focus();
    }
    await group.window.loadURL(GAME_URL);
  }

  /**
   * Open (or focus) one account's window on its own persisted session.
   * @param {string} id
   */
  async function openAccount(id) {
    const account = getAccount(id);
    const existing = sessions.get(id);
    if (existing && !existing.window.isDestroyed()) {
      existing.window.show();
      existing.window.focus();
      return;
    }
    const isolated = session.fromPartition(savedSessions.partition(id));
    applySessionPolicy(isolated, account.name, log);
    const window = new BrowserWindow({
      title: `Poolside · ${account.name}`,
      width: GAME_WINDOW_WIDTH,
      height: GAME_WINDOW_HEIGHT,
      minWidth: WINDOW_MIN_WIDTH,
      minHeight: WINDOW_MIN_HEIGHT,
      autoHideMenuBar: true,
      backgroundColor: '#14171b',
      webPreferences: {
        session: isolated,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false
      }
    });
    /** @type {import('./types.cjs').SessionGroup} */
    const group = { window, session: isolated, children: new Set(), status: 'loading' };
    sessions.set(id, group);
    applyNavigationPolicy(window.webContents, group);
    attachRecovery(id, group, { log, publish, getAccount, returnToGame });

    window.on('page-title-updated', event => {
      event.preventDefault();
      window.setTitle(`Poolside · ${account.name}`);
    });
    window.webContents.on('did-finish-load', () => {
      if (window.isDestroyed()) return;
      group.status = 'open';
      log(`${account.name}: page loaded. Sign-in is managed in the game window.`);
    });
    window.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
      if (!mainFrame || code === -3) return;
      group.status = 'error';
      log(`${account.name}: page could not load (code ${code}). Reopen the session to retry.`, 'warning');
    });
    window.on('closed', () => {
      for (const child of group.children) if (!child.isDestroyed()) child.destroy();
      sessions.delete(id);
      log(`${account.name}: window closed.`);
    });

    log(`${account.name}: opening a separate saved browser profile.`);
    try {
      await profiles.prepare(account, isolated);
      if (!window.isDestroyed()) await window.loadURL(GAME_URL);
    } catch (error) {
      if (!window.isDestroyed()) group.status = 'error';
      log(`${account.name}: ${messageOf(error)}`, 'warning');
    }
  }

  /** @param {string} id */
  function closeAccount(id) {
    const group = sessions.get(id);
    if (group && !group.window.isDestroyed()) group.window.close();
  }

  function closeAll() {
    for (const id of [...sessions.keys()]) closeAccount(id);
  }

  function arrange() {
    const windows = [...sessions.values()].map(group => group.window).filter(window => !window.isDestroyed());
    if (!windows.length) return;
    const area = screen.getPrimaryDisplay().workArea;
    const geometry = tileGeometry(windows.length, area);
    windows.forEach((window, index) => {
      // The minimum tracks the tile rather than being permanently lowered (was defect D7).
      window.setMinimumSize(geometry.minimumWidth, geometry.minimumHeight);
      window.setBounds(rectFor(index, geometry, area));
    });
    log(
      `Open game windows arranged on the main display (${geometry.cols}×${geometry.rows}, tile ${geometry.tileWidth}×${geometry.tileHeight}).`
    );
    if (geometry.cramped) {
      const limit = geometry.tileWidth < CRAMPED_WIDTH ? `${CRAMPED_WIDTH} wide` : '360 tall';
      log(`${windows.length} windows make each tile smaller than ${limit}; open fewer for a usable view.`, 'warning');
    }
  }

  return {
    openAccount,
    closeAccount,
    closeAll,
    returnToGame,
    arrange,
    flushAll: profiles.flushAll,
    hasProfiles: profiles.hasProfiles,
    attachRecoveryFor: (id, group) => attachRecovery(id, group, { log, publish, getAccount, returnToGame })
  };
}

module.exports = { createSessionManager, GAME_URL };
