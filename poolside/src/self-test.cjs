// The --self-test suite.
//
// Extracted from main.cjs and required lazily, so the production path never loads it. Everything it
// needs arrives as `ctx`: the suite deliberately drives the real app — real Electron sessions, the
// real dashboard, and IPC over the real bridge. It uses local HTTPS protocol fixtures rather than
// touching a real game account.
//
// The fixture-session scenarios (navigation, shop recovery, screen inspection, rejection) live in
// self-test-fixtures.cjs; this module owns the shared context, the cookie-isolation checks and the
// dashboard IPC contract checks.

/**
 * Everything the suite needs, injected by main.cjs so this module never reaches for app state
 * directly. Read by this module and by self-test-fixtures.cjs.
 * @typedef {object} SelfTestContext
 * @property {import('electron').App} app
 * @property {typeof import('electron').BrowserWindow} BrowserWindow
 * @property {typeof import('electron').session} session
 * @property {typeof import('./model.cjs')} model
 * @property {typeof import('node:fs')} fs
 * @property {Function} checkPublicIP
 * @property {import('./types.cjs').LogFn} log
 * @property {Function} attachRecovery
 * @property {Function} createSessionFsm
 * @property {Function} rememberWindowGeometry
 * @property {any} profiles
 * @property {any} crypto
 * @property {any} store
 * @property {any} monitor
 * @property {any} workspace
 * @property {Map<string, any>} sessions
 * @property {string} GAME_URL
 * @property {string} SHOP_PROBE
 * @property {{stats: Function}} screenReaders
 */

/**
 * @param {SelfTestContext} ctx
 */
async function runSelfTest(ctx) {
  const assert = require('node:assert/strict');
  const { runFixtureScenarios } = require('./self-test-fixtures.cjs');
  const { runFootprintChecks } = require('./self-test-footprint.cjs');
  const { runProfileChecks } = require('./self-test-profiles.cjs');
  const { runMatchChecks } = require('./self-test-matches.cjs');
  const { app, BrowserWindow, session, model, fs, checkPublicIP, log, workspace } = ctx;
  const dashboard = workspace.dashboard;
  assert.deepEqual(
    { size: ctx.screenReaders.stats().size, workers: ctx.screenReaders.stats().workers, warmed: ctx.screenReaders.stats().warmed },
    { size: 1, workers: 2, warmed: true },
    'both OCR workers are initialized before the dashboard can capture'
  );

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

  // --- Dashboard IPC: validation and sandbox ----------------------------------------------------
  // Before anything is added: a brand-new workspace tells the operator what to do, in the order it has to
  // happen. Read here, while the workspace really is empty, rather than assumed from the later state.
  const emptyWorkspace = await dashboard.webContents.executeJavaScript(`(async () => {
    const state = await poolside.get();
    return { show: state.value.guidance.show, steps: state.value.guidance.steps.map(step => step.title) };
  })()`);
  assert.equal(emptyWorkspace.show, true, 'an empty workspace offers the getting-started steps');
  assert.deepEqual(emptyWorkspace.steps, ['Add an account', 'Open it', 'Sign in on the game site']);
  const results = await dashboard.webContents.executeJavaScript(`(async () => {
    const a = await poolside.add({ name: 'Test receiver', role: 'receiver' });
    const b = await poolside.add({ name: 'Test sender', role: 'sender' });
    const duplicate = await poolside.add({ name: 'Test receiver', role: 'sender' });
    const result = await poolside.get();
    return { a: a.ok, b: b.ok, duplicate: duplicate.ok, count: result.value.accounts.length, bridge: typeof require, inspection: document.querySelector('#inspection-status').textContent };
  })()`);
  assert.deepEqual(results, { a: true, b: true, duplicate: false, count: 2, bridge: 'undefined', inspection: 'Waiting' });
  assert.equal(model.decode(JSON.parse(fs.readFileSync(workspace.storeFile, 'utf8'))).accounts.length, 2);
  assert.equal(model.decode(JSON.parse(fs.readFileSync(`${workspace.storeFile}.previous`, 'utf8'))).accounts.length, 1);
  // The way back, through the real bridge: the previous copy is described for the dashboard — what it holds,
  // when it was written, and that it can be read — and nothing in the description carries a credential.
  const recoveryPreview = await dashboard.webContents.executeJavaScript(`(async () => {
    const preview = await poolside.recoveryPreview();
    return {
      ok: preview.ok,
      candidates: preview.ok
        ? preview.value.candidates.map(candidate => ({ source: candidate.source, usable: candidate.usable, accounts: candidate.accounts.length, writtenAt: candidate.writtenAt }))
        : []
    };
  })()`);
  assert.equal(recoveryPreview.ok, true);
  assert.equal(recoveryPreview.candidates.length, 1, 'the previous copy is offered');
  assert.equal(recoveryPreview.candidates[0].source, 'previous');
  assert.equal(recoveryPreview.candidates[0].usable, true);
  assert.equal(recoveryPreview.candidates[0].accounts, 1, 'it holds the one account the first write did');
  assert.ok(Number.isFinite(Date.parse(recoveryPreview.candidates[0].writtenAt)));
  const about = await dashboard.webContents.executeJavaScript(`(async () => {
    const response = await poolside.get();
    document.querySelector('button[data-view="about"]').click();
    return {
      version: response.value.capabilityReport.version,
      unavailable: response.value.capabilityReport.capabilities.find(item => item.id === 'live-game-input').mode,
      visible: !document.querySelector('#view-about').classList.contains('hidden'),
      text: document.querySelector('#about-capabilities').textContent,
      support: document.querySelector('#about-support').textContent
    };
  })()`);
  assert.equal(about.version, app.getVersion());
  assert.equal(about.unavailable, 'unavailable');
  assert.equal(about.visible, true, 'the About navigation opens the rendered capability view');
  assert.match(about.text, /Live game input/);
  assert.match(about.text, /No production pointer or keyboard input/);
  assert.match(about.support, /Windows 11 x64/);
  const ipControls = await dashboard.webContents.executeJavaScript(`(async () => {
    const state = await poolside.get();
    const closed = await poolside.checkIP(state.value.accounts[0].id);
    return { buttons: document.querySelectorAll('[data-action="check-ip"]').length, disabled: [...document.querySelectorAll('[data-action="check-ip"]')].every(b => b.disabled), rejected: !closed.ok };
  })()`);
  assert.deepEqual(ipControls, { buttons: 2, disabled: true, rejected: true });

  // --- The configuration schema boundary, through the real IPC bridge ---------------------------
  const configBoundary = await dashboard.webContents.executeJavaScript(`(async () => {
    const refused = await poolside.saveSettings({ values: { table: 'Atlantis', limit: '10' } });
    const accepted = await poolside.saveSettings({ values: { table: 'Rome', limit: '25', junk: 'drop me' } });
    const stored = (await poolside.get()).value.settings;
    const form = await poolside.settingsForm();
    return {
      saved: refused.ok ? refused.value.saved : null,
      paths: refused.ok ? refused.value.errors.map(problem => problem.path) : [],
      messages: refused.ok ? refused.value.errors.map(problem => problem.message) : [],
      accepted: accepted.ok ? accepted.value.saved : false,
      table: stored.table,
      limit: stored.limit,
      hasJunk: Object.prototype.hasOwnProperty.call(stored, 'junk'),
      formPaths: form.ok ? form.value.paths : [],
      rendered: document.querySelectorAll('#settings-fields [data-path]').length
    };
  })()`);
  assert.equal(configBoundary.saved, false, 'an unknown table must be refused before it is stored');
  assert.deepEqual(configBoundary.paths, ['table'], 'the refusal names the control it belongs to, not the panel');
  assert.match(configBoundary.messages.join(' '), /Preferred table must be one of/);
  assert.equal(configBoundary.accepted, true, 'a usable setting is still saved');
  assert.equal(configBoundary.table, 'Rome', 'the validated value is what is stored');
  assert.equal(configBoundary.limit, 25, 'a number typed as text arrives as a number');
  assert.equal(configBoundary.hasJunk, false, 'an undeclared key must not reach the workspace document');
  // The form is generated from the schema (ADR-0017): every declared field has a control, and the controls are
  // in the page rather than in a hardcoded list in the renderer.
  for (const path of ['table', 'limit', 'identity.userAgent', 'identity.timezone', 'proxy.enabled', 'proxy.spec']) {
    assert.ok(configBoundary.formPaths.includes(path), `${path} must have a generated control`);
  }
  assert.equal(configBoundary.rendered, configBoundary.formPaths.length, 'every declared control is in the DOM');

  // --- Ticking an account onto a saved network location, through the settings list itself ------------
  // The assignment story is "paste the address, save it, tick the account", so this drives those three
  // steps in the real page and reads the box back from the DOM. A checkbox that never reaches the IPC,
  // or a list that redraws from a local guess instead of the stored document, fails here.
  const routeAssignment = await dashboard.webContents.executeJavaScript(`(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    document.querySelector('button[data-view="settings"]').click();
    document.querySelector('#route-preset-name').value = 'Self-test location';
    document.querySelector('#route-preset-spec').value = '198.51.100.7:8080';
    document.querySelector('#route-preset-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const until = Date.now() + 8000;
    const row = () => Array.from(document.querySelectorAll('.route-preset')).find(item => item.querySelector('strong') && item.querySelector('strong').textContent === 'Self-test location');
    while (!row() && Date.now() < until) await wait(100);
    if (!row()) return { error: 'the saved location never appeared in the settings list' };
    const presetId = row().querySelector('[data-route-preset-delete]').dataset.routePresetDelete;
    const boxes = Array.from(document.querySelectorAll('[data-route-preset-assign="' + presetId + '"]'));
    const receiver = (await poolside.get()).value.accounts.find(account => account.name === 'Test receiver');
    const selector = '[data-route-preset-assign="' + presetId + '"][data-route-account="' + receiver.id + '"]';
    const box = document.querySelector(selector);
    if (!box) return { error: 'the location offered no tick box for the account' };
    const label = box.getAttribute('aria-label');
    const tick = checked => {
      const current = document.querySelector(selector);
      current.checked = checked;
      current.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const assigned = async () => (await poolside.get()).value.accounts.filter(account => account.routePresetId === presetId).map(account => account.name);
    tick(true);
    while (!(await assigned()).length && Date.now() < until) await wait(100);
    const names = await assigned();
    // The reply carries the refreshed workspace, so the list redraws itself and the box stays ticked.
    while (!document.querySelector(selector).checked && Date.now() < until) await wait(100);
    const renderedChecked = document.querySelector(selector).checked;
    tick(false);
    while ((await poolside.get()).value.accounts.some(account => account.routePresetId === presetId) && Date.now() < until) await wait(100);
    const assignmentsLeft = (await poolside.get()).value.accounts.filter(account => account.routePresetId === presetId).length;
    const removed = await poolside.deleteRoutePreset(presetId);
    return { boxes: boxes.length, label, names, renderedChecked, assignmentsLeft, removed: removed.ok, presets: (await poolside.get()).value.routePresets.length };
  })()`);
  assert.equal(routeAssignment.error, undefined, `the settings list refused the assignment: ${routeAssignment.error}`);
  assert.equal(routeAssignment.boxes, 2, 'each saved location offers one tick box per account');
  assert.equal(routeAssignment.label, 'Connect Test receiver from Self-test location');
  assert.deepEqual(routeAssignment.names, ['Test receiver'], 'only the ticked account connects from the location');
  assert.equal(routeAssignment.renderedChecked, true, 'the box redraws from the stored assignment');
  assert.equal(routeAssignment.assignmentsLeft, 0, 'unticking clears the assignment rather than storing an empty one');
  assert.equal(routeAssignment.removed, true, 'a location nothing uses can be removed again');
  assert.equal(routeAssignment.presets, 0, 'the self-test leaves no saved location behind');

  // --- The diagnostics payload: anonymised, then scanned, through the real bridge ----------------
  // ADR-0010 commits this to a payload that carries no account names, and the handler refuses to hand one over
  // that fails its own scan. Both halves are asserted here against the accounts this suite created.
  const diagnostics = await dashboard.webContents.executeJavaScript(`(async () => {
    const preview = await poolside.diagnosticsPreview();
    return { ok: preview.ok, error: String(preview.error || ''), clean: preview.ok ? preview.value.clean : false, entries: preview.ok ? preview.value.entries : -1, serialised: preview.ok ? JSON.stringify(preview.value.payload) : '' };
  })()`);
  assert.equal(diagnostics.ok, true, `the diagnostics payload was refused: ${diagnostics.error}`);
  assert.equal(diagnostics.clean, true);
  assert.ok(diagnostics.entries >= 0, 'the payload reports how many timeline entries it carries');
  for (const name of ['Test receiver', 'Test sender']) {
    assert.equal(diagnostics.serialised.includes(name), false, `${name} must not appear in an exportable payload`);
  }
  assert.equal(/[A-Za-z]:\\\\/.test(diagnostics.serialised), false, 'and neither must a filesystem path');

  // Saving takes the exact same redacted projection, then writes it under the trusted local data root. The bridge
  // only receives a filename, so it cannot learn or display an absolute user-directory path.
  const savedDiagnostics = await dashboard.webContents.executeJavaScript(`(async () => {
    const saved = await poolside.diagnosticsSave();
    return { ok: saved.ok, error: String(saved.error || ''), fileName: saved.ok ? saved.value.fileName : '', clean: saved.ok ? saved.value.clean : false };
  })()`);
  assert.equal(savedDiagnostics.ok, true, `the diagnostics file was refused: ${savedDiagnostics.error}`);
  assert.equal(savedDiagnostics.clean, true);
  assert.match(savedDiagnostics.fileName, /^poolside-diagnostics-.*\.json$/);
  assert.equal(savedDiagnostics.fileName.includes('\\'), false, 'the renderer receives no filesystem path');
  const bundleFile = require('node:path').join(app.getPath('userData'), 'diagnostics', savedDiagnostics.fileName);
  const savedBundle = fs.readFileSync(bundleFile, 'utf8');
  for (const name of ['Test receiver', 'Test sender'])
    assert.equal(savedBundle.includes(name), false, `${name} must not be in the local export`);
  // --- The Activity view renders the merged timeline, not just the payload -----------------------
  // The payload being correct and the panel showing it are different claims; this asserts the second one.
  const timelinePanel = await dashboard.webContents.executeJavaScript(`(() => {
    const panel = document.querySelector('#timeline');
    const rows = panel ? panel.querySelectorAll('.event').length : -1;
    const marks = panel ? Array.from(panel.querySelectorAll('.event-mark')).map(mark => mark.className) : [];
    return { exists: Boolean(panel), rows, warningMarks: marks.filter(name => name.includes('warning')).length };
  })()`);
  assert.equal(timelinePanel.exists, true, 'the Activity view has a timeline panel');
  assert.ok(timelinePanel.rows > 0, `the timeline panel rendered rows (saw ${timelinePanel.rows})`);

  // --- Navigation, shop recovery, screen inspection and rejection, against an HTTPS fixture -----
  await runFixtureScenarios(ctx, assert, receiver);

  // --- Per-session footprint: identity, route, storage ceiling ----------------------------------
  await runFootprintChecks(ctx, assert, log);

  // --- Profile lifecycle: establishment, integrity, measurement, explicit deletion --------------
  await runProfileChecks(ctx, assert, log);

  // --- Local match coordination: pairing, profile loading, readiness, result ----------------------
  await runMatchChecks(ctx, assert);

  if (process.argv.includes('--live-ip-check')) {
    await checkPublicIP(receiver);
    console.log('PASS: live IP service returned a valid address through the isolated Chromium session. Address omitted from logs.');
  }
  console.log(
    'PASS: independent private cookie jars, cookies retained when a window reopens, IPC validation, persisted account metadata, sandboxed dashboard, truthful local screen-inspection status, capability About view, a settings form generated from the configuration schema that refuses an unusable value by naming the control it belongs to and never stores an undeclared key, a saved network location assigned to one account by ticking its box in the settings list and cleared again by unticking it, a run plan whose match limit the program enforced by ending the run itself, a pairing verdict that refuses to call two loaded profiles a pairing because neither screen has been read, a match with no session behind it cleared as a dropout so the accounts were free to pair again, a diagnostics payload that is anonymised, scanned and refused if it still carries a name, a path or a route credential, a run report screened by the same scan before it reaches the disk, and the Activity timeline rendering the merged history rather than only computing it.'
  );
  app.exit(0);
}

module.exports = { runSelfTest };
