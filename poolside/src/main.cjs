// Poolside composition root.
const { app, BrowserWindow, ipcMain, dialog, safeStorage, screen, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const model = require('./model.cjs');
const { createScreenReaderPool } = require('./screen-reader-pool.cjs');
const { createScreenReader } = require('./game-screen.cjs');
const { createTableVisualMatcher } = require('./table-visual.cjs');
const workspaceStore = require('./workspace.cjs');
const { log, save, load, publish, getAccount } = workspaceStore;
const { sessions, workspace, matchState } = require('./state.cjs');
const { createSessionManager } = require('./windows.cjs');
const { createObservationServices } = require('./observation-services.cjs');
const { createTableNavigationService } = require('./table-navigation-service.cjs');
const { createTableNavigationJournal } = require('./table-navigation-journal.cjs');
const { createCaptureLab } = require('./capture-lab.cjs');
const { createMatchJournal } = require('./match-journal.cjs');
const { createMatchService, participantReady } = require('./match-service.cjs');
const { createAccountIpCheck } = require('./network-ipc.cjs');
const { buildSelfTestContext } = require('./self-test-context.cjs');
const { createActivityJournal } = require('./activity-journal.cjs');
const { createIpc } = require('./ipc.cjs');
const { createProfileManager } = require('./profile-manager.cjs');
const { messageOf } = require('./errors.cjs');
const { createNativeDialogs } = require('./native-dialogs.cjs');
const selfTestWorkspace = require('./self-test-workspace.cjs');

const UI_FILE = path.join(__dirname, 'ui', 'index.html');
const UI_URL = pathToFileURL(UI_FILE).href;
const selfTest = process.argv.includes('--self-test');
const gameCheck = process.argv.includes('--game-check');
const testing = selfTest || gameCheck;

if (selfTest) [process.stdout, process.stderr].forEach(output => output.on('error', error => error && error.code === 'EPIPE'));

app.setName('Poolside');
if (testing) {
  // A unique directory per run: the process id alone used to repeat, and a run that inherited an earlier
  // run's workspace failed its account checks for reasons that had nothing to do with the code.
  const temporaryRoot = app.getPath('temp');
  app.setPath('userData', path.join(temporaryRoot, selfTestWorkspace.rootName(Date.now(), process.pid)));
  // Sweep what abandoned runs left behind, so the machine does not accumulate test profiles. Scoped to
  // this prefix directly under the temp directory, so nothing outside it can be reached from here.
  try {
    const entries = fs
      .readdirSync(temporaryRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && selfTestWorkspace.isSelfTestRoot(entry.name))
      .map(entry => ({ name: entry.name, modifiedMs: fs.statSync(path.join(temporaryRoot, entry.name)).mtimeMs }));
    for (const name of selfTestWorkspace.staleRoots(entries, { now: Date.now() })) {
      // One directory that cannot be removed — a profile still held open by a process that has not quite
      // finished exiting — must not stop the sweep for the rest.
      try {
        fs.rmSync(path.join(temporaryRoot, name), { recursive: true, force: true });
      } catch {
        /* it will be old enough again next run */
      }
    }
  } catch {
    // A sweep that cannot run is not a reason to fail the suite.
  }
}
if (!testing && !app.requestSingleInstanceLock()) app.exit(0);

const profileManager = createProfileManager({
  log,
  root: app.getPath('userData'),
  crypto: safeStorage
});
const activityJournal = createActivityJournal({ root: app.getPath('userData') });
const tableNavigationJournal = createTableNavigationJournal({ root: app.getPath('userData') });
const captureLab = createCaptureLab({ root: app.getPath('userData') });
const tableMatcher = createTableVisualMatcher({ references: () => captureLab.tableReferences() });
const screenReaders = createScreenReaderPool({
  size: 1,
  idleMs: 0,
  create: () => createScreenReader({ tableMatcher })
});
const { inspector, monitor } = createObservationServices({
  getAccount,
  publish,
  log,
  screenReaders,
  captureLab,
  deviceScaleFactor: () => screen.getPrimaryDisplay().scaleFactor,
  sessions
});
const windows = createSessionManager({
  log,
  publish,
  getAccount,
  selfTest,
  profileManager,
  onSessionOpened: testing
    ? null
    : id => {
        const group = sessions.get(id);
        if (group) group.monitoring = true;
        screenReaders.prewarm().catch(error => log(`Screen reader warm-up failed: ${messageOf(error)}`, 'warning'));
        monitor.start(id);
      },
  onSessionClosed: testing ? null : id => monitor.stop(id)
});
const tableNavigation = createTableNavigationService({
  sessions,
  getAccount,
  inspector,
  publish,
  log,
  journal: tableNavigationJournal
});
// Local match coordination. The ledger sits beside the other local journals, and the accounts in the
// workspace are its participants, so archiving an account mid-match cancels that match instead of
// leaving a match in progress that nobody can settle.
// One implementation of "read the address this session leaves through": the manual Check IP action and
// the barrier's proof that a configured route is doing something both use it.
const checkAccountIP = createAccountIpCheck({ sessions, getAccount, publish, log });
const matches = createMatchService({
  accounts: () => workspace.data.accounts,
  store: matchState,
  journal: createMatchJournal({ root: app.getPath('userData') }),
  // Starting a match loads both participants' sessions through the same path as "Open ↗".
  openSession: id => windows.openAccount(id),
  // Ready means this participant's own window is up and its session reached `ready`, not merely that
  // an open was requested. The barrier that gates release reads exactly this.
  ready: id => {
    const group = sessions.get(id);
    return participantReady({
      open: Boolean(group && group.window && typeof group.window.isDestroyed === 'function' && !group.window.isDestroyed()),
      status: group && group.fsm ? group.fsm.state : 'closed'
    });
  },
  // The richer verdict the barrier actually uses: the session, plus the route the session reported when
  // it opened. Chromium resolves that route locally, so this costs no request and cannot fail offline.
  participant: id => {
    const group = sessions.get(id);
    const open = Boolean(group && group.window && typeof group.window.isDestroyed === 'function' && !group.window.isDestroyed());
    const network = group ? group.network : null;
    return {
      open,
      status: open && group && group.fsm ? group.fsm.state : 'closed',
      footprint: group ? group.footprint : null,
      // The reason a failed read failed is in the activity log; this shape is what the barrier needs to
      // decide, and it deliberately carries no address of its own beyond the one the card already shows.
      exit: network ? { checked: network.status === 'checked', ip: network.ip || null, error: null } : null
    };
  },
  probeExit: id => checkAccountIP(id),
  // Pairing evidence comes from what each session's own screen reader last reported. Null is a session with
  // no reading yet, which the rules report as a missing reading rather than as disagreement.
  observe: id => {
    const group = sessions.get(id);
    return group && group.gameScreen ? group.gameScreen : null;
  },
  monotonic: () => performance.now(),
  publish,
  log
});
const { confirmChange, confirmDestructive, chooseDirectory } = createNativeDialogs({
  dialog,
  dashboard: () => workspace.dashboard,
  selfTest
});
const ipc = createIpc({
  ipcMain,
  UI_URL,
  windows,
  inspector,
  monitor,
  tableNavigation,
  matches,
  checkAccountIP,
  profiles: profileManager,
  captureLab,
  diagnosticsRoot: app.getPath('userData'),
  dataRoot: app.getPath('userData'),
  openPath: destination => shell.openPath(destination),
  chooseDirectory,
  confirmChange,
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
    // Do not expose a capture action until the pinned OCR worker is initialized. If startup
    // fails, inspections can retry creation through acquire(), and the warning remains visible.
    try {
      await screenReaders.prewarm();
    } catch (error) {
      log(`Screen reader warm-up failed: ${messageOf(error)}`, 'warning');
    }
    await createDashboard();
    log('Workspace ready. Account profiles and encrypted session backups are saved on this PC.');
    // Then measure, once the dashboard is on screen and the result has somewhere to appear.
    setImmediate(() => profileManager.measure(workspace.data.accounts));
    // Decode local Evidence logos after first paint, so the first table inspection does not pay
    // the one-time image feature cost. An unreadable sample is skipped by the matcher.
    if (!testing) setImmediate(() => tableMatcher.warm().catch(() => {}));
    if (selfTest)
      await require('./self-test.cjs').runSelfTest(
        buildSelfTestContext({
          profileManager,
          safeStorage,
          workspaceStore,
          windows,
          monitor,
          screenReaders
        })
      );
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
    tableNavigation.dispose();
    matches.dispose();
    await screenReaders.closeAll().catch(() => {});
    if (results.some(r => r.status === 'rejected')) {
      dialog.showErrorBox('Session save incomplete', 'Some login state could not be saved. Existing profile files remain on this PC.');
    }
    quitSaved = true;
    app.quit();
  });
});
