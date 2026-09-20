// session: it drives the FSM (session-fsm.cjs) from real Electron events, hands recovery policy to
// supervision.cjs, and applies the configured footprint through footprint.cjs at the two moments
// Electron allows. Geometry lives in session-window.cjs and geometry.cjs.

const { app, session } = require('electron');
const savedSessions = require('./saved-session.cjs');
const { applySessionPolicy, applyNavigationPolicy } = require('./hardening.cjs');
const { createProfileStore } = require('./profiles.cjs');
const { attachRecovery } = require('./recovery.cjs');
const { createSessionFsm } = require('./session-fsm.cjs');
const { attachSupervision } = require('./supervision.cjs');
const { arrangeSessions } = require('./window-arrange.cjs');
const { createSessionWindow, captureGeometry, describeRestore } = require('./session-window.cjs');
const { attachSessionEvents } = require('./session-events.cjs');
const { applyTargetFootprint } = require('./target-identity.cjs');
const { verifyRoute, reportFootprint } = require('./footprint.cjs');
const { createSessionConfig } = require('./session-config.cjs');
const { messageOf } = require('./errors.cjs');
const { resolveRecovery } = require('./recovery-settings.cjs');
const { sessions, workspace } = require('./state.cjs');
const store = require('./workspace.cjs');

const GAME_URL = 'https://8ballpool.com/game';

/**
 * @param {{log: import('./types.cjs').LogFn, publish: () => void, getAccount: (id: string) => import('./types.cjs').Account, selfTest: boolean, profileManager: any}} deps
 */
function createSessionManager(deps) {
  const { log, publish, getAccount, selfTest, profileManager } = deps;
  const profiles = createProfileStore({ log, publish });
  // The configuration-facing half of a session: the schema boundary and the footprint application.
  const config = createSessionConfig({
    log,
    getSettings: () => ({
      ...(workspace.data && workspace.data.settings),
      routePresets: (workspace.data && workspace.data.routePresets) || []
    }),
    sessionFor: id => session.fromPartition(savedSessions.partition(id)),
    userAgent: () => app.userAgentFallback
  });

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
    group.fsm.send('reload', 'returned to the game');
    log(`${account.name}: returning to the game using the existing session.`);
    if (!selfTest && focus) {
      group.window.show();
      group.window.focus();
    }
    await group.window.loadURL(GAME_URL);
  }

  function recoverWith(window) {
    return () => {
      if (window.isDestroyed()) return;
      window.webContents.reload();
    };
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
    // Establish this account's storage and keep its generation counter current, before anything is
    // created that will write into it.
    profileManager.initialise(account);
    const footprint = await config.applyFootprint(account);
    const isolated = session.fromPartition(savedSessions.partition(id));
    applySessionPolicy(isolated, account.name, log);

    const { window, restore } = createSessionWindow({
      title: `Poolside · ${account.name}`,
      session: isolated,
      remembered: store.savedWindowGeometry(id),
      backgroundThrottling: resolveRecovery(account).backgroundThrottling
    });
    if (restore.adjusted) log(`${account.name}: window ${describeRestore(restore)}.`);
    // Every state change republishes; only a degradation is worth an activity-feed entry, or the
    // feed fills with launch/load/ready chatter.
    const fsm = createSessionFsm({
      id: account.name,
      log,
      onTransition: ({ to, reason }) => {
        if (to === 'degraded' && reason) log(`${account.name}: session needs attention (${reason}).`, 'warning');
        publish();
      }
    });
    /** @type {import('./types.cjs').SessionGroup} */
    const group = { window, session: isolated, children: new Set(), fsm, footprint };
    sessions.set(id, group);
    const supervision = attachSupervision({ label: account.name, group, fsm, log, publish, recover: recoverWith(window) });
    group.supervision = supervision;
    group.health = supervision.health;
    applyNavigationPolicy(window.webContents, group);
    attachRecovery(id, group, { log, publish, getAccount, returnToGame });
    fsm.send('launch');

    attachSessionEvents({
      window,
      group,
      fsm,
      supervision,
      accountName: account.name,
      log,
      beforeClose: () => {
        // Geometry is captured while the window still exists; by `closed` the bounds are already gone.
        const geometry = captureGeometry(window);
        if (geometry) store.rememberWindowGeometry(id, geometry);
      },
      onClosed: () => sessions.delete(id)
    });

    // Target-level overrides need a live target, so they run here rather than with the rest.
    group.footprint.target = await applyTargetFootprint(window.webContents, footprint, log);

    log(`${account.name}: opening a separate saved browser profile.`);
    try {
      await profiles.prepare(account, isolated);
      if (window.isDestroyed()) return;
      fsm.send('load');
      await window.loadURL(GAME_URL);
    } catch (error) {
      fsm.send('failed', messageOf(error));
      log(`${account.name}: ${messageOf(error)}`, 'warning');
      return;
    }
    await reportFootprint(group, isolated, { log, accountName: account.name, gameUrl: GAME_URL, publish });
  }

  /**
   * Ask Chromium what a live session will really use, on demand.
   * @param {string} id
   */
  async function checkRoute(id) {
    getAccount(id);
    const group = sessions.get(id);
    if (!group || group.window.isDestroyed()) throw new Error('Open this account window first.');
    const verified = await verifyRoute(group.session, group.footprint.route, GAME_URL);
    group.footprint.verified = verified;
    publish();
    return verified;
  }

  function reloadAccount(id) {
    const account = getAccount(id);
    const group = sessions.get(id);
    if (!group || group.window.isDestroyed()) throw new Error('Open this account window before reloading it.');
    group.fsm.send('reload', 'manual page reload');
    log(`${account.name}: reloading the browser page on request.`);
    group.window.webContents.reload();
    publish();
  }

  function closeAccount(id) {
    const group = sessions.get(id);
    if (group && !group.window.isDestroyed()) group.window.close();
  }

  function closeAll() {
    for (const id of [...sessions.keys()]) closeAccount(id);
  }

  function arrange() {
    arrangeSessions({ log, sessions });
  }

  return {
    openAccount,
    closeAccount,
    closeAll,
    returnToGame,
    reloadAccount,
    checkRoute,
    arrange,
    flushAll: profiles.flushAll,
    hasProfiles: profiles.hasProfiles,
    attachRecoveryFor: (id, group) => attachRecovery(id, group, { log, publish, getAccount, returnToGame })
  };
}

module.exports = { createSessionManager, GAME_URL };
