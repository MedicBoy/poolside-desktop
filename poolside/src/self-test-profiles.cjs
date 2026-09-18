// Profile management checks for --self-test.
//
// The manager, the integrity engine and the diagnostics tracker all have unit tests, but those run against
// a hand-made temporary directory. This drives the real thing: the real data root, the real encryption
// backend, the real workspace document, and the real generation counter surviving a save and a reload.
//
// Nothing here touches a game account. The partition directory is simulated rather than created by
// Chromium, because opening a session would navigate to the live site.

const path = require('node:path');

/**
 * @param {import('./self-test.cjs').SelfTestContext} ctx
 * @param {typeof import('node:assert/strict')} assert
 * @param {import('./types.cjs').LogFn} log
 */
async function runProfileChecks(ctx, assert, log) {
  const { profiles, model, fs, crypto, workspace, sessions, store, app } = ctx;
  const plist = require('./plist.cjs');
  const cookies = require('./session-cookies.cjs');
  const savedSessions = require('./saved-session.cjs');
  const paths = require('./profile-paths.cjs');
  const root = app.getPath('userData');

  const account = model.account({ name: 'Profile lifecycle check', role: 'receiver' });
  store.save({ ...workspace.data, accounts: [...workspace.data.accounts, account] });
  const reread = () => store.getAccount(account.id);
  const directory = paths.profileDirectory(root, account.id);
  const carryOver = paths.carryOverFile(root, account.id);

  // --- Establishment, and a generation counter that does not inflate ---------------------------
  const created = profiles.initialise(account);
  assert.equal(created.action, 'created', 'a profile with no storage yet is created');
  assert.equal(created.generation, 1);
  profiles.initialise(reread());
  assert.equal(reread().profile.generation, 1, 'opening an account again is not a new generation');

  // --- A real measurement of real bytes, of a real directory -----------------------------------
  fs.mkdirSync(path.join(directory, 'Cache'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'Cache', 'data.bin'), Buffer.alloc(4096));
  fs.writeFileSync(path.join(directory, 'Cookies'), Buffer.alloc(128));
  profiles.initialise(reread());
  assert.equal(reread().profile.generation, 1, 'storage appearing for the first time is not a re-establishment');
  assert.equal(reread().profile.established, true, 'seeing the directory establishes it');
  // A configured ceiling is compared against the measured bytes: the number the dashboard shows comes
  // from the same identity config the session uses, so this proves the comparison is real.
  store.save({
    ...workspace.data,
    accounts: workspace.data.accounts.map(entry =>
      entry.id === account.id ? { ...entry, identity: { ...(entry.identity || {}), quotaBytes: 1024 } } : entry
    )
  });
  profiles.measure([reread()]);
  const report = profiles.report(account.id);
  assert.ok(report, 'the measurement is stored where the snapshot reads it from');
  assert.equal(report.directoryBytes, 4096 + 128, 'the profile size is measured, not estimated');
  assert.equal(report.quotaBytes, 1024, 'the ceiling comes from the account identity');
  assert.equal(report.overQuota, true, 'exceeding it is reported, not enforced');

  // --- A damaged file is quarantined, counted, and never deleted -------------------------------
  fs.mkdirSync(path.dirname(carryOver), { recursive: true });
  fs.writeFileSync(carryOver, '<plist><dict><key>Format</key><string>Poolside Windows Session v2</string></dict></plist>');
  const damaged = profiles.scan([reread()], { measure: false });
  assert.equal(damaged.verdicts[0].state, 'corrupt');
  assert.equal(fs.existsSync(carryOver), false, 'the damaged file is moved out of the way');
  const kept = fs.readdirSync(path.dirname(carryOver)).filter(name => name.includes('.corrupt-'));
  assert.equal(kept.length, 1, 'the damaged file is kept as evidence, not deleted');
  assert.equal(reread().profile.corruption.count, 1, 'the corruption is recorded against the account');
  assert.match(reread().profile.corruption.lastReason, /no encrypted session payload/);
  assert.equal(damaged.orphans.removed.profiles.length, 0, 'a live account is never swept');
  assert.equal(damaged.orphans.kept.unclaimed.length, 0, 'and never reported as unclaimed either');

  // A healthy file is not touched by a scan.
  const xml = plist.buildDocument({
    format: 'Poolside Windows Session v2',
    scope: cookies.SCOPE,
    accountId: account.id,
    name: account.name,
    role: account.role,
    browserProfile: savedSessions.partition(account.id),
    cookieCount: 1,
    savedAt: new Date().toISOString(),
    secret: crypto
      .encryptString(
        JSON.stringify({
          version: cookies.PAYLOAD_VERSION,
          scope: cookies.SCOPE,
          accountId: account.id,
          savedAt: new Date().toISOString(),
          cookies: [{ name: 'session', value: 'x', domain: '8ballpool.com', path: '/' }]
        })
      )
      .toString('base64')
  });
  fs.writeFileSync(carryOver, xml);
  const healthy = profiles.scan([reread()], { measure: false });
  assert.equal(healthy.verdicts[0].state, 'ok', healthy.verdicts[0].issues.join('; '));
  assert.equal(healthy.verdicts[0].cookies, 1);
  assert.equal(fs.existsSync(carryOver), true, 'a healthy file is left exactly where it is');
  assert.equal(reread().profile.corruption.count, 1, 'a clean scan adds nothing to the history');

  // --- Deletion is explicit, refuses while open, and takes everything with it ------------------
  sessions.set(account.id, {});
  await assert.rejects(() => profiles.remove(reread()), /Close this session/);
  assert.equal(fs.existsSync(directory), true, 'a refused delete changes nothing on disk');
  sessions.delete(account.id);
  const outcome = await profiles.remove(reread());
  assert.equal(fs.existsSync(directory), false, 'the profile directory is gone');
  assert.equal(fs.existsSync(carryOver), false, 'the carry-over file is gone');
  assert.equal(
    fs.readdirSync(path.dirname(carryOver)).filter(name => name.includes('.corrupt-')).length,
    0,
    'the quarantined evidence goes with it'
  );
  assert.equal(reread().profile, undefined, 'the profile record goes with it');
  assert.equal(outcome.failures.length, 0, outcome.failures.join('; '));

  store.save({ ...workspace.data, accounts: workspace.data.accounts.filter(a => a.id !== account.id) });
  log('Profile lifecycle checks finished.');
  console.log(
    `PASS: profile lifecycle — established once (generation ${created.generation}, unchanged on reopen), ` +
      `${report.directoryBytes} bytes measured and compared against a ${report.quotaBytes} byte ceiling that is ` +
      `reported rather than enforced, a damaged saved session quarantined as evidence and counted against the ` +
      `account, a healthy one left untouched, and an explicit delete refused while the session was open before ` +
      `removing the directory, the file and the record.`
  );
}

module.exports = { runProfileChecks };
