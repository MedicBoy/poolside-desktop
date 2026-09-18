// Poolside — composition root.
//
// Wiring only: application lifecycle, the workspace document, the dashboard, and the last-resort
// error surface. Feature behaviour lives in its own module — windows.cjs (sessions), profiles.cjs
// (saved sessions), hardening.cjs (policy), recovery.cjs (supervision), inspection.cjs (screen
// recognition), ipc.cjs (the dashboard contract) and self-test.cjs (the test suite).

const { app, BrowserWindow, ipcMain, dialog, session, safeStorage, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const model = require('./model.cjs');
const { checkPublicIP } = require('./network.cjs');
const { SHOP_PROBE } = require('./shop-recovery.cjs');
const { createScreenReaderPool } = require('./screen-reader-pool.cjs');
const workspaceStore = require('./workspace.cjs');
const { log, save, load, publish, getAccount, rememberWindowGeometry } = workspaceStore;
const { sessions, workspace } = require('./state.cjs');
const { createSessionManager, GAME_URL } = require('./windows.cjs');
const { createSessionFsm } = require('./session-fsm.cjs');
const { createInspector } = require('./inspection.cjs');
const { createIpc } = require('./ipc.cjs');
const { createProfileManager } = require('./profile-manager.cjs');
const { messageOf } = require('./errors.cjs');

const UI_FILE = path.join(__dirname, 'ui', 'index.html');
const UI_URL = pathToFileURL(UI_FILE).href;
const selfTest = process.argv.includes('--self-test');
const gameCheck = process.argv.includes('--game-check');
const testing = selfTest || gameCheck;

app.setName('Poolside');
if (testing) app.setPath('userData', path.join(app.getPath('temp'), `poolside-test-${process.pid}`));
if (!testing && !app.requestSingleInstanceLock()) app.exit(0);

// One warm pool for the whole app instead of a worker per inspection. Size 1 keeps memory
// predictable; this is the knob to raise in M9 once per-session cost has been measured.
const screenReaders = createScreenReaderPool({ size: 1, idleMs: 120000 });

// Profile lifecycle, integrity and diagnostics. Created before the session manager because every window
// open establishes that account's storage through it.
const profileManager = createProfileManager({
  log,
  root: app.getPath('userData'),
  crypto: safeStorage
});
const windows = createSessionManager({ log, publish, getAccount, selfTest, profileManager });
const inspector = createInspector({
  getAccount,
  publish,
  log,
  screenReaders,
  // The display's own scale factor, so a capture's density can be compared with what was expected rather
  // than assumed to be 1. Read at inspection time, never cached: it changes when a window moves displays.
  deviceScaleFactor: () => screen.getPrimaryDisplay().scaleFactor
});

/**
 * Ask before destroying something irreversible. A headless test run answers "no" rather than blocking on
 * a dialog nobody can see.
 */
async function confirmDestructive(title, detail) {
  if (selfTest) return false;
  const prompt = {
    type: /** @type {'warning'} */ ('warning'),
    buttons: ['Cancel', 'Delete'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Poolside',
    message: title,
    detail
  };
  // Parented to the dashboard when there is one, so the dialog cannot end up behind it.
  const parent = workspace.dashboard;
  const { response } = parent ? await dialog.showMessageBox(parent, prompt) : await dialog.showMessageBox(prompt);
  return response === 1;
}

const ipc = createIpc({ ipcMain, UI_URL, windows, inspector, profiles: profileManager, confirmDestructive });

app.on('second-instance', () => {
  const dashboard = workspace.dashboard;
  if (dashboard && !dashboard.isDestroyed()) {
    if (dashboard.isMinimized()) dashboard.restore();
    dashboard.show();
    dashboard.focus();
  }
});

function createDashboard() {
  const dashboard = new BrowserWindow({
    title: 'Poolside',
    width: 1260,
    height: 850,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: '#101719',
    autoHideMenuBar: true,
    show: !selfTest,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  workspace.dashboard = dashboard;
  dashboard.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  dashboard.webContents.on('will-navigate', event => event.preventDefault());
  dashboard.on('closed', () => {
    windows.closeAll();
    app.quit();
  });
  return dashboard.loadFile(UI_FILE);
}

/** Smoke-check that the official game page loads in a real window. Requires user sign-in. */
async function runGameCheck() {
  const account = model.account({ name: 'Game compatibility check', role: 'receiver' });
  save({ ...workspace.data, accounts: [account] });
  windows.openAccount(account.id);
  const group = sessions.get(account.id);
  if (!group) throw new Error('The verification window did not open.');
  const timer = setTimeout(() => {
    console.error('Game page load timed out.');
    app.exit(1);
  }, 45000);
  group.window.webContents.once('did-finish-load', () => {
    clearTimeout(timer);
    console.log('Game page loaded:', group.window.webContents.getURL());
    console.log('Visual inspection and user sign-in are still required. Close the app to finish this check.');
  });
}

function selfTestContext() {
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
    SHOP_PROBE
  };
}

let quitting = false;
let quitSaved = false;

app
  .whenReady()
  .then(async () => {
    workspace.version = app.getVersion();
    load(path.join(app.getPath('userData'), 'workspace.json'));
    // Integrity first, without measuring: checking a small file per account is quick, while walking every
    // profile directory is not, and the window should not wait for it.
    profileManager.scan(workspace.data.accounts, { measure: false });
    ipc.register();
    await createDashboard();
    log('Workspace ready. Account profiles and encrypted session backups are saved on this PC.');
    // Then measure, once the dashboard is on screen and the result has somewhere to appear.
    setImmediate(() => profileManager.measure(workspace.data.accounts));
    if (selfTest) await require('./self-test.cjs').runSelfTest(selfTestContext());
    if (gameCheck) await runGameCheck();
  })
  .catch(error => {
    console.error(error);
    if (!selfTest) dialog.showErrorBox('Poolside could not start', messageOf(error));
    app.exit(1);
  });

app.on('window-all-closed', () => app.quit());

app.on('before-quit', event => {
  if (quitSaved || !windows.hasProfiles()) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  windows.flushAll().then(async results => {
    await screenReaders.closeAll().catch(() => {});
    if (results.some(r => r.status === 'rejected')) {
      dialog.showErrorBox('Session save incomplete', 'Some login state could not be saved. Existing profile files remain on this PC.');
    }
    quitSaved = true;
    app.quit();
  });
});
