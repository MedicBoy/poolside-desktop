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
 * @property {Function} attachRecovery
 * @property {Function} createSessionFsm
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
  const { app, BrowserWindow, session, model, fs, checkPublicIP, workspace } = ctx;
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

  // --- Navigation, shop recovery, screen inspection and rejection, against an HTTPS fixture -----
  await runFixtureScenarios(ctx, assert, receiver);

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
