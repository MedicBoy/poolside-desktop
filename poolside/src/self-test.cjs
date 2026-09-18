// The --self-test suite.
//
// Extracted from main.cjs and required lazily, so the production path never loads it. Everything it
// needs arrives as `ctx`: the suite deliberately drives the real app — real Electron sessions, the
// real dashboard, and IPC over the real bridge. It uses local HTTPS protocol fixtures rather than
// touching a real game account.

/**
 * Everything the suite needs, injected by main.cjs so this module never reaches for app state
 * directly.
 * @typedef {object} SelfTestContext
 * @property {import('electron').App} app
 * @property {typeof import('electron').BrowserWindow} BrowserWindow
 * @property {typeof import('electron').session} session
 * @property {typeof import('./model.cjs')} model
 * @property {typeof import('node:fs')} fs
 * @property {Function} checkPublicIP
 * @property {Function} attachRecovery
 * @property {any} workspace
 * @property {Map<string, any>} sessions
 * @property {string} GAME_URL
 * @property {string} SHOP_PROBE
 */

/**
 * @param {SelfTestContext} ctx
 */
async function runSelfTest(ctx) {
  const assert = require('node:assert/strict');
  const { app, BrowserWindow, session, model, fs, checkPublicIP, attachRecovery, workspace, sessions, GAME_URL, SHOP_PROBE } = ctx;
  const dashboard = workspace.dashboard;

  // --- Cookie isolation between two account sessions -------------------------------------------
  const receiver = session.fromPartition('test-receiver');
  const sender = session.fromPartition('test-sender');
  await receiver.cookies.set({ url: 'https://example.test', name: 'session', value: 'receiver' });
  assert.equal((await sender.cookies.get({ name: 'session' })).length, 0);
  await sender.cookies.set({ url: 'https://example.test', name: 'session', value: 'sender' });
  assert.equal((await receiver.cookies.get({ name: 'session' }))[0].value, 'receiver');
  assert.notEqual(receiver, sender);
  assert.equal(receiver.isPersistent(), false);
  assert.equal(sender.isPersistent(), false);
  const firstWindow = new BrowserWindow({ show: false, webPreferences: { session: receiver, sandbox: true } });
  firstWindow.destroy();
  const reopened = new BrowserWindow({ show: false, webPreferences: { session: session.fromPartition('test-receiver'), sandbox: true } });
  assert.equal((await reopened.webContents.session.cookies.get({ name: 'session' }))[0].value, 'receiver');
  assert.equal((await sender.cookies.get({ name: 'session' }))[0].value, 'sender');
  reopened.destroy();

  // --- Dashboard IPC: validation, sandbox, and the disabled transfer control -------------------
  const results = await dashboard.webContents.executeJavaScript(`(async () => {
    const a = await poolside.add({ name: 'Test receiver', role: 'receiver' });
    const b = await poolside.add({ name: 'Test sender', role: 'sender' });
    const duplicate = await poolside.add({ name: 'Test receiver', role: 'sender' });
    const result = await poolside.get();
    return { a: a.ok, b: b.ok, duplicate: duplicate.ok, count: result.value.accounts.length, bridge: typeof require, disabled: document.querySelector('#start-transfer').disabled };
  })()`);
  assert.deepEqual(results, { a: true, b: true, duplicate: false, count: 2, bridge: 'undefined', disabled: true });
  assert.equal(model.decode(JSON.parse(fs.readFileSync(workspace.storeFile, 'utf8'))).accounts.length, 2);
  const ipControls = await dashboard.webContents.executeJavaScript(`(async () => {
    const state = await poolside.get();
    const closed = await poolside.checkIP(state.value.accounts[0].id);
    return { buttons: document.querySelectorAll('[data-action="check-ip"]').length, disabled: [...document.querySelectorAll('[data-action="check-ip"]')].every(b => b.disabled), rejected: !closed.ok };
  })()`);
  assert.deepEqual(ipControls, { buttons: 2, disabled: true, rejected: true });

  // --- Navigation and recovery, against a local HTTPS fixture ----------------------------------
  receiver.protocol.handle(
    'https',
    request =>
      new Response(
        new URL(request.url).pathname === '/shop'
          ? '<body><h1>FEATURED</h1><p>WEB SHOP EXCLUSIVE</p><nav>Weekly Deals</nav></body>'
          : '<title>Navigation fixture</title>'
      )
  );
  const navigationWindow = new BrowserWindow({
    show: false,
    webPreferences: { session: receiver, sandbox: true, backgroundThrottling: false }
  });
  const navigationId = workspace.data.accounts[0].id;
  sessions.set(navigationId, { window: navigationWindow, session: receiver, children: new Set(), status: 'open' });
  await navigationWindow.loadURL('https://example.test/shop');
  const navigationResult = await dashboard.webContents.executeJavaScript(`poolside.returnGame(${JSON.stringify(navigationId)})`);
  assert.equal(navigationResult.ok, true);
  assert.equal(navigationWindow.webContents.getURL(), GAME_URL);
  assert.equal((await receiver.cookies.get({ name: 'session' }))[0].value, 'receiver');
  assert.equal(navigationWindow.webContents.getBackgroundThrottling(), false);
  await navigationWindow.loadURL('https://8ballpool.com/shop');
  const probe = () => navigationWindow.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: SHOP_PROBE }]);
  assert.equal(await probe(), true);
  await navigationWindow.webContents.executeJavaScript(
    `document.body.insertAdjacentHTML('beforeend', '<canvas width="600" height="400"></canvas>')`
  );
  assert.equal(await probe(), false);
  await navigationWindow.webContents.executeJavaScript(
    `document.querySelector('canvas').remove(); document.body.insertAdjacentHTML('beforeend', '<input type="password">')`
  );
  assert.equal(await probe(), false);
  await navigationWindow.webContents.executeJavaScript(`document.querySelector('input').remove()`);
  attachRecovery(navigationId, sessions.get(navigationId));
  await /** @type {Promise<void>} */ (
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Automatic shop return timed out in fixture')), 12000);
      navigationWindow.webContents.once('did-finish-load', () => {
        clearTimeout(timeout);
        resolve();
      });
    })
  );
  assert.equal(navigationWindow.webContents.getURL(), GAME_URL);
  assert.equal(sessions.get(navigationId).shopGate.used, true);
  assert.equal((await receiver.cookies.get({ name: 'session' }))[0].value, 'receiver');
  console.log('PASS: automatic shop return, visible-game/login exclusions, and background-throttling setting.');

  // --- Screen inspection -----------------------------------------------------------------------
  await navigationWindow.webContents.executeJavaScript(`(() => {
    document.body.innerHTML = '<canvas width="600" height="400"></canvas>';
    const context = document.querySelector('canvas').getContext('2d');
    context.fillStyle = '#145488'; context.fillRect(0, 0, 600, 400);
    context.fillStyle = 'white'; context.font = '32px Arial'; context.fillText('Connecting', 190, 260);
  })()`);
  const inspected = await dashboard.webContents.executeJavaScript(`poolside.inspect(${JSON.stringify(navigationId)})`);
  assert.equal(inspected.ok, true, inspected.error);
  const observed = sessions.get(navigationId).gameScreen;
  assert.equal(observed.state, 'connecting');
  assert.ok(observed.score > 0, 'a recognised screen reports a confidence');
  assert.ok(observed.evidence.includes('connecting'), 'evidence names the matched phrase');
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
  await navigationWindow.webContents.executeJavaScript(
    `document.querySelectorAll('canvas').forEach((canvas, index) => { if (index > 0) canvas.remove(); })`
  );
  await navigationWindow.webContents.executeJavaScript(`document.body.insertAdjacentHTML('beforeend', '<input type="password">')`);
  const blockedInspection = await dashboard.webContents.executeJavaScript(`poolside.inspect(${JSON.stringify(navigationId)})`);
  assert.equal(blockedInspection.ok, false);
  assert.match(blockedInspection.error, /sign-in field or dialog/, 'the failure names the reason');
  await navigationWindow.webContents.executeJavaScript(`document.body.innerHTML = '<canvas width="120" height="60"></canvas>'`);
  const unusable = await dashboard.webContents.executeJavaScript(`poolside.inspect(${JSON.stringify(navigationId)})`);
  assert.equal(unusable.ok, false);
  assert.match(unusable.error, /large enough/, 'the failure explains why nothing was usable');
  assert.match(unusable.error, /120×60/, 'the failure reports the surfaces that were seen');
  console.log('PASS: unusable or absent game surfaces fail with a diagnostic instead of a bare null.');
  console.log('PASS: live canvas capture, local OCR through IPC, and exclusion of visible login fields.');

  // --- Rejection after the session is gone -----------------------------------------------------
  sessions.delete(navigationId);
  navigationWindow.destroy();
  receiver.protocol.unhandle('https');
  const closedNavigation = await dashboard.webContents.executeJavaScript(`poolside.returnGame(${JSON.stringify(navigationId)})`);
  assert.equal(closedNavigation.ok, false);
  console.log('PASS: return-to-game navigation through dashboard IPC retains the account session and rejects closed windows.');

  if (process.argv.includes('--live-ip-check')) {
    await checkPublicIP(receiver);
    console.log('PASS: live IP service returned a valid address through the isolated Chromium session. Address omitted from logs.');
  }
  console.log(
    'PASS: independent private cookie jars, cookies retained when a window reopens, IPC validation, persisted account metadata, sandboxed dashboard, and unavailable transfer control.'
  );
  app.exit(0);
}

module.exports = { runSelfTest };
