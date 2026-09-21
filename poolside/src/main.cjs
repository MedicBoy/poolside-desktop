// Poolside composition root.
const { app, BrowserWindow, ipcMain, dialog, session, safeStorage, screen, shell } = require('electron');
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
const { createObservationServices } = require('./observation-services.cjs');
const { createCaptureLab } = require('./capture-lab.cjs');
const { createActivityJournal } = require('./activity-journal.cjs');
const { createIpc } = require('./ipc.cjs');
const { createProfileManager } = require('./profile-manager.cjs');
const { messageOf } = require('./errors.cjs');
const { createNativeDialogs } = require('./native-dialogs.cjs');

const UI_FILE = path.join(__dirname, 'ui', 'index.html');
const UI_URL = pathToFileURL(UI_FILE).href;
const selfTest = process.argv.includes('--self-test');
const gameCheck = process.argv.includes('--game-check');
const testing = selfTest || gameCheck;

if (selfTest) [process.stdout, process.stderr].forEach(output => output.on('error', error => error && error.code === 'EPIPE'));

app.setName('Poolside');
if (testing) app.setPath('userData', path.join(app.getPath('temp'), `poolside-test-${process.pid}`));
if (!testing && !app.requestSingleInstanceLock()) app.exit(0);

const screenReaders = createScreenReaderPool({ size: 1, idleMs: 120000 });

const profileManager = createProfileManager({
  log,
  root: app.getPath('userData'),
  crypto: safeStorage
});
const activityJournal = createActivityJournal({ root: app.getPath('userData') });
const windows = createSessionManager({ log, publish, getAccount, selfTest, profileManager });
const captureLab = createCaptureLab({ root: app.getPath('userData') });
const { inspector, monitor } = createObservationServices({
  getAccount,
  publish,
  log,
  screenReaders,
  captureLab,
  deviceScaleFactor: () => screen.getPrimaryDisplay().scaleFactor,
  sessions
});
const { confirmDestructive, chooseDirectory } = createNativeDialogs({ dialog, dashboard: () => workspace.dashboard, selfTest });
const ipc = createIpc({
  ipcMain,
  UI_URL,
  windows,
  inspector,
  monitor,
  profiles: profileManager,
  captureLab,
  diagnosticsRoot: app.getPath('userData'),
  dataRoot: app.getPath('userData'),
  openPath: destination => shell.openPath(destination),
  chooseDirectory,
  confirmDestructive
});

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
    SHOP_PROBE,
    monitor
  };
}

let quitting = false;
let quitSaved = false;

app
  .whenReady()
  .then(async () => {
    workspace.version = app.getVersion();
    workspaceStore.configureActivityJournal(activityJournal);
    load(path.join(app.getPath('userData'), 'workspace.json'));
    workspaceStore.loadActivityHistory();
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
    monitor.dispose();
    await screenReaders.closeAll().catch(() => {});
    if (results.some(r => r.status === 'rejected')) {
      dialog.showErrorBox('Session save incomplete', 'Some login state could not be saved. Existing profile files remain on this PC.');
    }
    quitSaved = true;
    app.quit();
  });
});
