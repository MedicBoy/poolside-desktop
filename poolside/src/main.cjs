const { app, BrowserWindow, ipcMain, session, dialog, screen, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const model = require('./model.cjs');
const { checkPublicIP } = require('./network.cjs');
const { SHOP_PROBE, ShopReturnGate, officialPage } = require('./shop-recovery.cjs');
const { GAME_REGION_PROBE, REGION_REASONS } = require('./game-region.cjs');
const { tileGeometry, rectFor, WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT } = require('./layout.cjs');
const { createScreenReaderPool } = require('./screen-reader-pool.cjs');
const savedSessions = require('./saved-session.cjs');
const profileStores = new Map();
// One warm pool for the whole app instead of a worker per inspection. Size 1 keeps memory
// predictable; this is the knob to raise in M9 once per-session cost has been measured.
const screenReaders = createScreenReaderPool({ size: 1, idleMs: 120000 });
let quitting = false;
let quitSaved = false;
const GAME_URL = 'https://8ballpool.com/game';
const UI_FILE = path.join(__dirname, 'ui', 'index.html');
const UI_URL = pathToFileURL(UI_FILE).href;
const selfTest = process.argv.includes('--self-test');
const gameCheck = process.argv.includes('--game-check');
const testing = selfTest || gameCheck;
app.setName('Poolside');
if (testing) app.setPath('userData', path.join(app.getPath('temp'), `poolside-test-${process.pid}`));
if (!testing && !app.requestSingleInstanceLock()) app.exit(0);
const sessions = new Map();
const events = [];
let dashboard;
app.on('second-instance', () => {
  if (dashboard && !dashboard.isDestroyed()) { if (dashboard.isMinimized()) dashboard.restore(); dashboard.show(); dashboard.focus(); }
});
let storeFile;
let data = { version: 1, accounts: [], settings: { table: 'Bangkok', limit: 10 } };
let readOnly = false;
function log(message, kind = 'info') {
  events.unshift({ id: Date.now() + Math.random(), at: new Date().toISOString(), message, kind });
  events.splice(100);
  publish();
}
function snapshot() {
  return { accounts: data.accounts.filter(a => !a.archived).map(a => ({ ...a, status: sessions.get(a.id)?.status || 'closed', network: sessions.get(a.id)?.network || null, gameScreen: sessions.get(a.id)?.gameScreen || null })), settings: data.settings, events, readOnly, version: app.getVersion() };
}
function publish() { if (dashboard && !dashboard.isDestroyed()) dashboard.webContents.send('workspace:changed', snapshot()); }
function save(next) {
  if (readOnly) throw new Error('Workspace data could not be read. Restart after fixing the workspace file; existing data has not been overwritten.');
  fs.mkdirSync(path.dirname(storeFile), { recursive: true });
  fs.writeFileSync(storeFile + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(storeFile + '.tmp', storeFile);
  data = next;
  publish();
}
function getAccount(id) {
  const a = data.accounts.find(a => a.id === id && !a.archived);
  if (!a) throw new Error('Account not found.');
  return a;
}
function isWeb(url) { try { return new URL(url).protocol === 'https:'; } catch { return false; } }
function harden(contents, group) {
  contents.on('will-navigate', (event, url) => { if (!isWeb(url)) event.preventDefault(); });
  contents.on('will-redirect', (event, url) => { if (!isWeb(url)) event.preventDefault(); });
  contents.setWindowOpenHandler(({ url }) => ({ action: isWeb(url) ? 'allow' : 'deny', overrideBrowserWindowOptions: { autoHideMenuBar: true, width: 960, height: 760, webPreferences: { session: group.session, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } } }));
  contents.on('did-create-window', child => { group.children.add(child); harden(child.webContents, group); child.on('closed', () => group.children.delete(child)); });
}
async function openAccount(id) {
  const a = getAccount(id);
  const old = sessions.get(id);
  if (old && !old.window.isDestroyed()) { old.window.show(); old.window.focus(); return; }
  const isolated = session.fromPartition(savedSessions.partition(id));
  isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  if (!isolated.poolsideConfigured) {
    isolated.on('will-download', event => { event.preventDefault(); log(`${a.name}: a download was blocked.`, 'warning'); });
    isolated.poolsideConfigured = true;
  }
  const window = new BrowserWindow({ title: `Poolside · ${a.name}`, width: 1060, height: 800, minWidth: WINDOW_MIN_WIDTH, minHeight: WINDOW_MIN_HEIGHT, autoHideMenuBar: true, backgroundColor: '#14171b', webPreferences: { session: isolated, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false } });
  const group = { window, session: isolated, children: new Set(), status: 'loading' };
  sessions.set(id, group);
  harden(window.webContents, group);
  attachRecovery(id, group);
  window.on('page-title-updated', event => { event.preventDefault(); window.setTitle(`Poolside · ${a.name}`); });
  window.webContents.on('did-finish-load', () => { if (!window.isDestroyed()) { group.status = 'open'; log(`${a.name}: page loaded. Sign-in is managed in the game window.`); } });
  window.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => { if (mainFrame && code !== -3) { group.status = 'error'; log(`${a.name}: page could not load (code ${code}). Reopen the session to retry.`, 'warning'); } });
  window.on('closed', () => { for (const child of group.children) if (!child.isDestroyed()) child.destroy(); sessions.delete(id); log(`${a.name}: window closed.`); });
  log(`${a.name}: opening a separate saved browser profile.`);
  try {
    await prepareProfile(a, isolated);
    if (!window.isDestroyed()) await window.loadURL(GAME_URL);
  } catch (error) {
    if (!window.isDestroyed()) group.status = 'error';
    log(`${a.name}: ${error.message}`, 'warning');
  }
}
function prepareProfile(account, isolated) {
  const previous = profileStores.get(account.id);
  if (previous) return previous.ready;
  const root = app.getPath('userData');
  const store = { queue: Promise.resolve(), timer: null, ready: null, flush: null };
  profileStores.set(account.id, store);
  store.flush = () => {
    clearTimeout(store.timer);
    const save = () => savedSessions.saveSession(root, account, isolated, safeStorage);
    store.queue = store.queue.then(save, save);
    return store.queue;
  };
  store.ready = (async () => {
    await savedSessions.restoreSession(root, account, isolated, safeStorage);
    await store.flush();
    isolated.cookies.on('changed', () => {
      clearTimeout(store.timer);
      store.timer = setTimeout(() => store.flush().catch(() => log(`${account.name}: session could not be saved.`, 'warning')), 500);
    });
  })();
  return store.ready;
}
function attachRecovery(id, group) {
  const wc = group.window.webContents;
  const gate = new ShopReturnGate();
  group.shopGate = gate;
  let busy = false;
  let generation = 0;
  const repaintTimers = new Set();
  const clearRepaints = () => { for (const timer of repaintTimers) clearTimeout(timer); repaintTimers.clear(); };
  wc.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame) { generation++; group.observationGeneration = generation; group.gameScreen = null; gate.reset(); publish(); if (!inPlace) clearRepaints(); }
  });
  wc.on('did-finish-load', () => {
    clearRepaints();
    if (!officialPage(wc.getURL())) return;
    for (const delay of [0, 1000, 3000, 8000]) {
      const timer = setTimeout(() => { repaintTimers.delete(timer); if (!wc.isDestroyed()) wc.invalidate(); }, delay);
      repaintTimers.add(timer);
    }
  });
  group.window.on('focus', () => { if (!wc.isDestroyed()) wc.invalidate(); });
  const poll = setInterval(async () => {
    if (busy || wc.isDestroyed() || gate.used) return;
    const url = wc.getURL();
    if (!officialPage(url) || wc.isLoadingMainFrame()) { gate.reset(); return; }
    busy = true;
    const observedGeneration = generation;
    try {
      const shop = await wc.executeJavaScriptInIsolatedWorld(999, [{ code: SHOP_PROBE }]);
      if (wc.isDestroyed() || observedGeneration !== generation || url !== wc.getURL()) return;
      if (gate.observe(url, shop === true, Date.now())) {
        log(`${getAccount(id).name}: shop remained visible for five seconds; returning to the game automatically.`);
        await returnToGame(id, false);
      }
    } catch { gate.reset(); } finally { busy = false; }
  }, 1000);
  group.window.once('closed', () => { clearInterval(poll); clearRepaints(); });
}
function closeAccount(id) { const g = sessions.get(id); if (g && !g.window.isDestroyed()) g.window.close(); }
function describeRegionFailure(region) {
  const reason = REGION_REASONS[region?.reason] || 'Could not isolate the game area.';
  const seen = (region?.candidates || []).slice(0, 3)
    .map(c => `${c.kind} ${c.width}×${c.height} (aspect ${c.aspect}, ${Math.round(c.coverage * 100)}% of view)`)
    .join('; ');
  return seen ? `${reason} Surfaces seen: ${seen}.` : reason;
}
async function inspectGame(id) {
  const account = getAccount(id);
  const group = sessions.get(id);
  if (!group || group.window.isDestroyed()) throw new Error('Open this account window first.');
  // Per-account lock. This used to be a single module-level flag, so inspecting one account
  // blocked every other account (was defect D6).
  if (group.inspecting) throw new Error('A screen inspection is already running for this account. Try again shortly.');
  const wc = group.window.webContents;
  if (!officialPage(wc.getURL()) || wc.isLoadingMainFrame()) throw new Error('Wait for the official game page to finish loading.');
  const generation = group.observationGeneration;
  const stillCurrent = () => sessions.get(id) === group && !wc.isDestroyed() && group.observationGeneration === generation;
  group.inspecting = true;
  group.gameScreen = { state: 'inspecting' };
  publish();
  let timeout;
  let expired = false;
  try {
    const work = async () => {
      const region = await wc.executeJavaScriptInIsolatedWorld(999, [{ code: GAME_REGION_PROBE }]);
      if (!region || !region.ok) throw new Error(describeRegionFailure(region));
      const zoom = wc.getZoomFactor();
      const rect = { x: Math.floor(region.rect.x * zoom), y: Math.floor(region.rect.y * zoom), width: Math.floor(region.rect.width * zoom), height: Math.floor(region.rect.height * zoom) };
      const picture = await wc.capturePage(rect);
      if (picture.isEmpty()) throw new Error('No game image was available.');
      const entry = await screenReaders.acquire();
      try {
        if (expired) throw new Error('Screen inspection timed out.');
        const reader = await entry.reader;
        return await reader.inspect(picture.resize({ width: 1200 }).toPNG());
      } finally {
        screenReaders.release(entry);
      }
    };
    const result = await Promise.race([work(), new Promise((_, reject) => {
      timeout = setTimeout(() => { expired = true; reject(new Error('Screen inspection timed out.')); }, 30000);
    })]);
    if (stillCurrent()) {
      group.gameScreen = result;
      const evidence = result.evidence.length ? result.evidence.join(', ') : 'no matching phrases';
      log(`${account.name}: screen observation: ${result.state} (confidence ${result.score}) from ${evidence}. This is a single image, not a responsiveness check.`);
    }
  } catch (error) {
    if (stillCurrent()) { group.gameScreen = { state: 'unknown', observedAt: new Date().toISOString() }; publish(); }
    throw error;
  } finally {
    clearTimeout(timeout);
    group.inspecting = false;
  }
}
async function returnToGame(id, focus = true) {
  const a = getAccount(id);
  const group = sessions.get(id);
  if (!group || group.window.isDestroyed()) throw new Error('Open this account window first.');
  if (group.shopGate) group.shopGate.used = true;
  group.status = 'loading';
  log(`${a.name}: returning to the game using the existing session.`);
  if (!selfTest && focus) { group.window.show(); group.window.focus(); }
  await group.window.loadURL(GAME_URL);
}
async function checkAccountIP(id) {
  const a = getAccount(id);
  const group = sessions.get(id);
  if (!group) throw new Error('Open this account window before checking its IP.');
  if (group.network?.status === 'checking') return;
  group.network = { status: 'checking' };
  publish();
  try {
    const result = await checkPublicIP(group.session);
    if (sessions.get(id) !== group) return;
    group.network = { status: 'checked', ...result };
    log(`${a.name}: public IP checked using this session. This does not verify game routing or location.`);
  } catch (error) {
    if (sessions.get(id) !== group) return;
    group.network = { status: 'error' };
    log(`${a.name}: ${error.message}`, 'warning');
    throw error;
  }
}
function arrange() {
  const windows = [...sessions.values()].map(g => g.window).filter(w => !w.isDestroyed());
  if (!windows.length) return;
  const area = screen.getPrimaryDisplay().workArea;
  const geometry = tileGeometry(windows.length, area);
  windows.forEach((w, i) => {
    // The minimum tracks the tile rather than being permanently lowered (was defect D7).
    w.setMinimumSize(geometry.minimumWidth, geometry.minimumHeight);
    w.setBounds(rectFor(i, geometry, area));
  });
  log(`Open game windows arranged on the main display (${geometry.cols}×${geometry.rows}, tile ${geometry.tileWidth}×${geometry.tileHeight}).`);
  if (geometry.cramped) log(`${windows.length} windows make each tile smaller than ${geometry.tileWidth < 420 ? '420 wide' : '360 tall'}; open fewer for a usable view.`, 'warning');
}
function trusted(event) { if (!dashboard || event.sender !== dashboard.webContents || event.senderFrame !== dashboard.webContents.mainFrame || event.senderFrame.url !== UI_URL) throw new Error('Request rejected.'); }
function handle(name, fn) { ipcMain.handle(name, async (event, input) => { try { trusted(event); const result = await fn(input); return { ok: true, value: result ?? snapshot() }; } catch (error) { return { ok: false, error: error.message }; } }); }
function register() {
  handle('workspace:get', () => snapshot());
  handle('account:add', input => { const a = model.account(input, data.accounts.filter(a => !a.archived)); save({ ...data, accounts: [...data.accounts, a] }); log(`${a.name}: account slot created.`); });
  handle('account:open', id => openAccount(id));
  handle('account:close', id => { getAccount(id); closeAccount(id); });
  handle('account:check-ip', checkAccountIP);
  handle('account:return-game', returnToGame);
  handle('account:inspect', inspectGame);
  handle('account:archive', id => { const a = getAccount(id); if (sessions.has(id)) throw new Error('Close this session before archiving it.'); save({ ...data, accounts: data.accounts.map(a => a.id === id ? { ...a, archived: true } : a) }); log(`${a.name}: account slot archived.`); });
  handle('sessions:open', async () => { await Promise.all(data.accounts.filter(a => !a.archived).map(a => openAccount(a.id))); });
  handle('sessions:close', () => { for (const id of [...sessions.keys()]) closeAccount(id); });
  handle('sessions:arrange', arrange);
  handle('settings:save', input => { save({ ...data, settings: model.settings(input) }); log('Transfer preferences saved. Automation is not yet connected.'); });
}
function createDashboard() {
  dashboard = new BrowserWindow({ title: 'Poolside', width: 1260, height: 850, minWidth: 960, minHeight: 680, backgroundColor: '#101719', autoHideMenuBar: true, show: !selfTest, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  dashboard.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  dashboard.webContents.on('will-navigate', event => event.preventDefault());
  dashboard.on('closed', () => { for (const id of [...sessions.keys()]) closeAccount(id); app.quit(); });
  return dashboard.loadFile(UI_FILE);
}
async function runSelfTest() {
  const assert = require('node:assert/strict');
  const a = session.fromPartition('test-receiver');
  const b = session.fromPartition('test-sender');
  await a.cookies.set({ url: 'https://example.test', name: 'session', value: 'receiver' });
  assert.equal((await b.cookies.get({ name: 'session' })).length, 0);
  await b.cookies.set({ url: 'https://example.test', name: 'session', value: 'sender' });
  assert.equal((await a.cookies.get({ name: 'session' }))[0].value, 'receiver');
  assert.notEqual(a, b);
  assert.equal(a.isPersistent(), false);
  assert.equal(b.isPersistent(), false);
  const firstWindow = new BrowserWindow({ show: false, webPreferences: { session: a, sandbox: true } });
  firstWindow.destroy();
  const reopened = new BrowserWindow({ show: false, webPreferences: { session: session.fromPartition('test-receiver'), sandbox: true } });
  assert.equal((await reopened.webContents.session.cookies.get({ name: 'session' }))[0].value, 'receiver');
  assert.equal((await b.cookies.get({ name: 'session' }))[0].value, 'sender');
  reopened.destroy();
  const results = await dashboard.webContents.executeJavaScript(`(async () => {
    const a = await poolside.add({ name: 'Test receiver', role: 'receiver' });
    const b = await poolside.add({ name: 'Test sender', role: 'sender' });
    const duplicate = await poolside.add({ name: 'Test receiver', role: 'sender' });
    const result = await poolside.get();
    return { a: a.ok, b: b.ok, duplicate: duplicate.ok, count: result.value.accounts.length, bridge: typeof require, disabled: document.querySelector('#start-transfer').disabled };
  })()`);
  assert.deepEqual(results, { a: true, b: true, duplicate: false, count: 2, bridge: 'undefined', disabled: true });
  assert.equal(model.decode(JSON.parse(fs.readFileSync(storeFile, 'utf8'))).accounts.length, 2);
  const ipControls = await dashboard.webContents.executeJavaScript(`(async () => {
    const state = await poolside.get();
    const closed = await poolside.checkIP(state.value.accounts[0].id);
    return { buttons: document.querySelectorAll('[data-action="check-ip"]').length, disabled: [...document.querySelectorAll('[data-action="check-ip"]')].every(b => b.disabled), rejected: !closed.ok };
  })()`);
  assert.deepEqual(ipControls, { buttons: 2, disabled: true, rejected: true });
  // A local HTTPS fixture verifies navigation without touching real game accounts.
  a.protocol.handle('https', request => new Response(new URL(request.url).pathname === '/shop' ? '<body><h1>FEATURED</h1><p>WEB SHOP EXCLUSIVE</p><nav>Weekly Deals</nav></body>' : '<title>Navigation fixture</title>'));
  const navigationWindow = new BrowserWindow({ show: false, webPreferences: { session: a, sandbox: true, backgroundThrottling: false } });
  const navigationId = data.accounts[0].id;
  sessions.set(navigationId, { window: navigationWindow, session: a, children: new Set(), status: 'open' });
  await navigationWindow.loadURL('https://example.test/shop');
  const navigationResult = await dashboard.webContents.executeJavaScript(`poolside.returnGame(${JSON.stringify(navigationId)})`);
  assert.equal(navigationResult.ok, true);
  assert.equal(navigationWindow.webContents.getURL(), GAME_URL);
  assert.equal((await a.cookies.get({ name: 'session' }))[0].value, 'receiver');
  assert.equal(navigationWindow.webContents.getBackgroundThrottling(), false);
  await navigationWindow.loadURL('https://8ballpool.com/shop');
  const probe = () => navigationWindow.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: SHOP_PROBE }]);
  assert.equal(await probe(), true);
  await navigationWindow.webContents.executeJavaScript(`document.body.insertAdjacentHTML('beforeend', '<canvas width="600" height="400"></canvas>')`);
  assert.equal(await probe(), false);
  await navigationWindow.webContents.executeJavaScript(`document.querySelector('canvas').remove(); document.body.insertAdjacentHTML('beforeend', '<input type="password">')`);
  assert.equal(await probe(), false);
  await navigationWindow.webContents.executeJavaScript(`document.querySelector('input').remove()`);
  attachRecovery(navigationId, sessions.get(navigationId));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Automatic shop return timed out in fixture')), 12000);
    navigationWindow.webContents.once('did-finish-load', () => { clearTimeout(timeout); resolve(); });
  });
  assert.equal(navigationWindow.webContents.getURL(), GAME_URL);
  assert.equal(sessions.get(navigationId).shopGate.used, true);
  assert.equal((await a.cookies.get({ name: 'session' }))[0].value, 'receiver');
  console.log('PASS: automatic shop return, visible-game/login exclusions, and background-throttling setting.');
  await navigationWindow.webContents.executeJavaScript(`(() => {
    document.body.innerHTML = '<canvas width="600" height="400"></canvas>';
    const context = document.querySelector('canvas').getContext('2d');
    context.fillStyle = '#145488'; context.fillRect(0, 0, 600, 400);
    context.fillStyle = 'white'; context.font = '32px Arial'; context.fillText('Connecting', 190, 260);
  })()`);
  const inspected = await dashboard.webContents.executeJavaScript(`poolside.inspect(${JSON.stringify(navigationId)})`);
  assert.equal(inspected.ok, true, inspected.error);
  assert.equal(sessions.get(navigationId).gameScreen.state, 'connecting');
  assert.ok(sessions.get(navigationId).gameScreen.score > 0, 'a recognised screen reports a confidence');
  assert.ok(sessions.get(navigationId).gameScreen.evidence.includes('connecting'), 'evidence names the matched phrase');
  // Regression D4: the locator used to require exactly one visible canvas, so a second surface on
  // the page (the lobby draws its background as a canvas too) made the whole inspection fail.
  const crowded = await navigationWindow.webContents.executeJavaScript(`(() => {
    document.body.insertAdjacentHTML('beforeend', '<canvas width="1200" height="675" style="position:absolute;left:700px;top:520px"></canvas>');
    document.body.insertAdjacentHTML('beforeend', '<canvas width="40" height="30"></canvas>');
    document.body.insertAdjacentHTML('beforeend', '<canvas width="800" height="450" style="display:none"></canvas>');
    return document.querySelectorAll('canvas').length;
  })()`);
  assert.equal(crowded, 4, 'fixture has one game surface and three distractors');
  const crowdedInspection = await dashboard.webContents.executeJavaScript(`poolside.inspect(${JSON.stringify(navigationId)})`);
  assert.equal(crowdedInspection.ok, true, crowdedInspection.error);
  assert.equal(sessions.get(navigationId).gameScreen.state, 'connecting');
  console.log('PASS: the locator scores multiple surfaces instead of demanding exactly one (regression: D4).');
  await navigationWindow.webContents.executeJavaScript(`document.querySelectorAll('canvas').forEach((canvas, index) => { if (index > 0) canvas.remove(); })`);
  await navigationWindow.webContents.executeJavaScript(`document.body.insertAdjacentHTML('beforeend', '<input type="password">')`);
  const blockedInspection = await dashboard.webContents.executeJavaScript(`poolside.inspect(${JSON.stringify(navigationId)})`);
  assert.equal(blockedInspection.ok, false);
  assert.match(blockedInspection.error, /sign-in field or dialog/, 'the failure names the reason');
  // Regression D4: an unusable surface must fail with a diagnostic that says what was seen.
  await navigationWindow.webContents.executeJavaScript(`document.body.innerHTML = '<canvas width="120" height="60"></canvas>'`);
  const unusable = await dashboard.webContents.executeJavaScript(`poolside.inspect(${JSON.stringify(navigationId)})`);
  assert.equal(unusable.ok, false);
  assert.match(unusable.error, /large enough/, 'the failure explains why nothing was usable');
  assert.match(unusable.error, /120×60/, 'the failure reports the surfaces that were seen');
  console.log('PASS: unusable or absent game surfaces fail with a diagnostic instead of a bare null.');
  await navigationWindow.webContents.executeJavaScript(`document.body.innerHTML = '<canvas width="600" height="400"></canvas>'`);
  console.log('PASS: live canvas capture, local OCR through IPC, and exclusion of visible login fields.');
  sessions.delete(navigationId);
  navigationWindow.destroy();
  a.protocol.unhandle('https');
  const closedNavigation = await dashboard.webContents.executeJavaScript(`poolside.returnGame(${JSON.stringify(navigationId)})`);
  assert.equal(closedNavigation.ok, false);
  console.log('PASS: return-to-game navigation through dashboard IPC retains the account session and rejects closed windows.');
  if (process.argv.includes('--live-ip-check')) {
    await checkPublicIP(a);
    console.log('PASS: live IP service returned a valid address through the isolated Chromium session. Address omitted from logs.');
  }
  console.log('PASS: independent private cookie jars, cookies retained when a window reopens, IPC validation, persisted account metadata, sandboxed dashboard, and unavailable transfer control.');
  app.exit(0);
}
async function runGameCheck() {
  const a = model.account({ name: 'Game compatibility check', role: 'receiver' });
  save({ ...data, accounts: [a] });
  openAccount(a.id);
  const group = sessions.get(a.id);
  const timer = setTimeout(() => { console.error('Game page load timed out.'); app.exit(1); }, 45000);
  group.window.webContents.once('did-finish-load', () => {
    clearTimeout(timer);
    console.log('Game page loaded:', group.window.webContents.getURL());
    console.log('Visual inspection and user sign-in are still required. Close the app to finish this check.');
  });
}
app.whenReady().then(async () => {
  storeFile = path.join(app.getPath('userData'), 'workspace.json');
  if (fs.existsSync(storeFile)) { try { data = model.decode(JSON.parse(fs.readFileSync(storeFile, 'utf8'))); } catch { readOnly = true; log('Workspace file could not be read. Existing data was preserved.', 'warning'); } }
  register();
  await createDashboard();
  log('Workspace ready. Account profiles and encrypted session backups are saved on this PC.');
  if (selfTest) await runSelfTest();
  if (gameCheck) await runGameCheck();
}).catch(error => { console.error(error); if (!selfTest) dialog.showErrorBox('Poolside could not start', error.message); app.exit(1); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitSaved || profileStores.size === 0) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  Promise.allSettled([...profileStores.values()].map(async store => { await store.ready; await store.flush(); })).then(async results => {
    await screenReaders.closeAll().catch(() => {});
    if (results.some(r => r.status === 'rejected')) dialog.showErrorBox('Session save incomplete', 'Some login state could not be saved. Existing profile files remain on this PC.');
    quitSaved = true;
    app.quit();
  });
});
