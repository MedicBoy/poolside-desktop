// The fixture-session scenarios of the packaged self-test: navigation back to the game, automatic
// shop return, screen inspection against a synthetic canvas, and rejection once the session is gone.
//
// Split out of self-test.cjs to keep both modules under the size ceiling
// (test/architecture.test.cjs). Loaded only when --self-test runs.

/**
 * @param {import('./self-test.cjs').SelfTestContext} ctx
 * @param {typeof import('node:assert/strict')} assert
 * @param {import('electron').Session} receiver the fixture session, shared with the cookie checks
 */
async function runFixtureScenarios(ctx, assert, receiver) {
  const { BrowserWindow, workspace, sessions, GAME_URL, SHOP_PROBE, attachRecovery, createSessionFsm } = ctx;
  const dashboard = workspace.dashboard;
  const { POLL_INTERVAL_MS, PROBE_TIMEOUT_MS } = require('./recovery.cjs');
  const { resolveRecovery } = require('./recovery-settings.cjs');

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
  // A real session reaches `ready` through openAccount; the fixture drives the machine directly so
  // the dashboard contract can be checked without a live page.
  const fixtureFsm = createSessionFsm({ id: 'fixture' });
  fixtureFsm.send('launch');
  fixtureFsm.send('loaded');
  sessions.set(navigationId, { window: navigationWindow, session: receiver, children: new Set(), fsm: fixtureFsm });
  await navigationWindow.loadURL('https://example.test/shop');
  const navigationResult = await dashboard.webContents.executeJavaScript(`poolside.returnGame(${JSON.stringify(navigationId)})`);
  assert.equal(navigationResult.ok, true);
  assert.equal(navigationWindow.webContents.getURL(), GAME_URL);
  assert.equal((await receiver.cookies.get({ name: 'session' }))[0].value, 'receiver');
  assert.equal(navigationWindow.webContents.getBackgroundThrottling(), false);

  // The FSM is the only writer of session state, so what the dashboard renders must come from it: a
  // live session and a closed one have to be distinguishable in the snapshot *and* in the label the
  // user reads, and the status element must carry the class the stylesheet keys on.
  const statusContract = await dashboard.webContents.executeJavaScript(`(async () => {
    await new Promise(resolve => setTimeout(resolve, 50));
    const state = await poolside.get();
    const statuses = [...document.querySelectorAll('.account-card .status')];
    return {
      states: state.value.accounts.map(account => account.status),
      labels: statuses.map(node => node.textContent),
      classes: statuses.map(node => node.className)
    };
  })()`);
  assert.deepEqual(statusContract.states, ['loading', 'closed'], 'the snapshot reports FSM states');
  assert.deepEqual(statusContract.classes, ['status loading', 'status closed'], 'labels carry the state class');
  assert.match(statusContract.labels[0], /Loading game/, 'the live session renders its loading label');
  assert.match(statusContract.labels[1], /Window closed/, 'a session with no window renders as closed');

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
  // Wait for the outcome, not for one event by a fixed clock. The return is driven by a one-second poll
  // whose probe may be slow on a loaded machine, so the deadline is derived from the delay this account
  // is actually configured with plus the intervals involved, and the condition is the thing being
  // asserted: the window is back on the game and the gate says it returned it.
  const shopDelayMs = resolveRecovery(workspace.data.accounts[0]).shopReturnDelaySeconds * 1000;
  const returnDeadlineMs = shopDelayMs + POLL_INTERVAL_MS * 2 + PROBE_TIMEOUT_MS + 15000;
  const waitingSince = Date.now();
  await /** @type {Promise<void>} */ (
    new Promise((resolve, reject) => {
      const check = () => {
        const group = sessions.get(navigationId);
        if (!navigationWindow || navigationWindow.isDestroyed())
          return reject(new Error('Automatic shop return: the fixture window closed first.'));
        if (navigationWindow.webContents.getURL() === GAME_URL && group && group.shopGate && group.shopGate.used) return resolve();
        if (Date.now() - waitingSince > returnDeadlineMs)
          return reject(
            new Error(
              `Automatic shop return did not happen within ${Math.round(
                returnDeadlineMs / 1000
              )} s (url ${navigationWindow.webContents.getURL()}, gate used ${Boolean(group && group.shopGate && group.shopGate.used)}, delay ${shopDelayMs} ms).`
            )
          );
        setTimeout(check, 250);
      };
      check();
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
  // The canvas is drawn synchronously but composited asynchronously, and a window that is not on screen hands
  // back the last frame it painted — so a single inspection can catch the frame from before the drawing and
  // read "unrecognized". Measured: one run in about fifteen. Retry until the screen the fixture drew is the
  // screen that was read, and report what was seen if it never is.
  const readableUntil = Date.now() + 10000;
  while (sessions.get(navigationId).gameScreen.state !== 'connecting' && Date.now() < readableUntil) {
    await new Promise(resolve => setTimeout(resolve, 250));
    await dashboard.webContents.executeJavaScript(`poolside.inspect(${JSON.stringify(navigationId)})`);
  }
  const observed = sessions.get(navigationId).gameScreen;
  assert.equal(
    observed.state,
    'connecting',
    `the drawing was never read: ${JSON.stringify({ state: observed.state, evidence: observed.evidence })}`
  );
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
  console.log(
    'PASS: return-to-game navigation through dashboard IPC retains the account session, rejects closed windows, and reports FSM session states to the dashboard.'
  );
}

module.exports = { runFixtureScenarios };
