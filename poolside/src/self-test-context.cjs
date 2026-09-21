// What the self-test suite is allowed to inspect.
//
// Extracted from the composition root, which is a wiring layer and had reached its size ceiling. This is
// not wiring: it is the one place that says which parts of the running application the suite receives,
// so a reader can see the suite's reach in a single object rather than inferring it from main.cjs.
//
// Only the parts the composition root *builds* are passed in. Everything the suite inspects that already
// exists as a module is required here, so the call site stays a description of what the suite may touch.

const fs = require('node:fs');
const { app, BrowserWindow, session } = require('electron');
const model = require('./model.cjs');
const { checkPublicIP } = require('./network.cjs');
const { createSessionFsm } = require('./session-fsm.cjs');
const { sessions, workspace } = require('./state.cjs');
const { GAME_URL } = require('./windows.cjs');
const { SHOP_PROBE } = require('./shop-recovery.cjs');

/**
 * @param {{profileManager: any, safeStorage: any, workspaceStore: any, windows: any, monitor: any, screenReaders: any}} built
 */
function buildSelfTestContext({ profileManager, safeStorage, workspaceStore, windows, monitor, screenReaders }) {
  const { log, rememberWindowGeometry } = workspaceStore;
  return {
    app,
    BrowserWindow,
    session,
    model,
    fs,
    checkPublicIP,
    log,
    attachRecovery: (id, group) => windows.attachRecoveryFor(id, group),
    createSessionFsm,
    rememberWindowGeometry,
    profiles: profileManager,
    crypto: safeStorage,
    store: workspaceStore,
    workspace,
    sessions,
    GAME_URL,
    SHOP_PROBE,
    monitor,
    screenReaders
  };
}

module.exports = { buildSelfTestContext };
