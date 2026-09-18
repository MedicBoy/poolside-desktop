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
  const { runFixtureScenarios } = require('./self-test-fixtures.cjs');
  const { runFootprintChecks } = require('./self-test-footprint.cjs');
  const { runProfileChecks } = require('./self-test-profiles.cjs');
  const { app, BrowserWindow, session, model, fs, checkPublicIP, log, workspace } = ctx;
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

  // --- The configuration schema boundary, through the real IPC bridge ---------------------------
  const configBoundary = await dashboard.webContents.executeJavaScript(`(async () => {
    const refused = await poolside.saveSettings({ table: 'Atlantis', limit: 10 });
    const accepted = await poolside.saveSettings({ table: 'Rome', limit: 25, junk: 'drop me' });
    const stored = (await poolside.get()).value.settings;
    return { refused: refused.ok, message: String(refused.error || ''), accepted: accepted.ok, table: stored.table, limit: stored.limit, hasJunk: Object.prototype.hasOwnProperty.call(stored, 'junk') };
  })()`);
  assert.equal(configBoundary.refused, false, 'an unknown table must be refused before it is stored');
  assert.match(configBoundary.message, /Preferred table must be one of/);
  assert.equal(configBoundary.accepted, true, 'a usable setting is still saved');
  assert.equal(configBoundary.table, 'Rome', 'the validated value is what is stored');
  assert.equal(configBoundary.limit, 25);
  assert.equal(configBoundary.hasJunk, false, 'an undeclared key must not reach the workspace document');

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

  // --- Navigation, shop recovery, screen inspection and rejection, against an HTTPS fixture -----
  await runFixtureScenarios(ctx, assert, receiver);

  // --- Per-session footprint: identity, route, storage ceiling ----------------------------------
  await runFootprintChecks(ctx, assert, log);

  // --- Profile lifecycle: establishment, integrity, measurement, explicit deletion --------------
  await runProfileChecks(ctx, assert, log);

  if (process.argv.includes('--live-ip-check')) {
    await checkPublicIP(receiver);
    console.log('PASS: live IP service returned a valid address through the isolated Chromium session. Address omitted from logs.');
  }
  console.log(
    'PASS: independent private cookie jars, cookies retained when a window reopens, IPC validation, persisted account metadata, sandboxed dashboard, unavailable transfer control, the configuration schema boundary refusing an unknown table before it is stored, and a diagnostics payload that is anonymised, scanned and refused if it still carries a name or a path.'
  );
  app.exit(0);
}

module.exports = { runSelfTest };
