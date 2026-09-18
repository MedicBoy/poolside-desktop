const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProfileManager } = require('../src/profile-manager.cjs');
const { buildDocument } = require('../src/plist.cjs');
const { carryOverFile, profileDirectory } = require('../src/profile-paths.cjs');
const { workspace, sessions, profileReports } = require('../src/state.cjs');

const ID = 'e5b1c1b3-0000-4000-8000-000000000000';
const OTHER = 'f0e1d2c3-1111-4222-8333-444444444444';

const silently = () => {};

/** A reversible stand-in for safeStorage. */
const crypto = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value, 'utf8'),
  decryptString: value => value.toString('utf8')
};

/**
 * Point the real workspace document at a temporary file, so the manager's persistence goes through the
 * same code path production uses rather than a mock.
 */
function withWorkspace(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-manager-'));
  const previous = { data: workspace.data, storeFile: workspace.storeFile, readOnly: workspace.readOnly };
  const account = /** @type {import('../src/types.cjs').Account} */ ({
    id: ID,
    name: 'Main',
    role: 'receiver',
    archived: false,
    createdAt: new Date(0).toISOString()
  });
  workspace.storeFile = path.join(root, 'workspace.json');
  workspace.readOnly = false;
  workspace.data = { version: 1, accounts: [account], settings: { table: 'Bangkok', limit: 10 } };
  sessions.clear();
  profileReports.clear();
  const cleanup = () => {
    workspace.storeFile = previous.storeFile;
    workspace.data = previous.data;
    workspace.readOnly = previous.readOnly;
    sessions.clear();
    profileReports.clear();
    fs.rmSync(root, { recursive: true, force: true });
  };
  let result;
  try {
    result = run({ root, manager: createProfileManager({ log: silently, root, crypto }) });
  } catch (error) {
    cleanup();
    throw error;
  }
  // Async bodies must finish before the workspace and the temporary root are restored, or the test
  // reports failures from after it ended.
  if (result && typeof result.then === 'function') return result.finally(cleanup);
  cleanup();
  return result;
}

/** The account as the manager will next see it, which is what the workspace document holds. */
function fresh() {
  const account = workspace.data.accounts.find(entry => entry.id === ID);
  assert.ok(account, 'the account is still in the document');
  return account;
}

/** The persisted bookkeeping, asserted to be there so a missing record fails as itself, not as a crash. */
function profileOf() {
  const record = fresh().profile;
  assert.ok(record, 'the account has profile bookkeeping');
  return record;
}

function writeCarryOver(root, options = {}) {
  const file = carryOverFile(root, ID);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = options.payload ?? {
    version: 2,
    scope: 'session-cookies',
    accountId: ID,
    savedAt: '2026-09-18T00:00:00.000Z',
    cookies: [{ name: 'session', value: 'abc', domain: '8ballpool.com', path: '/' }]
  };
  fs.writeFileSync(
    file,
    buildDocument({
      format: 'Poolside Windows Session v2',
      scope: 'session-cookies',
      accountId: options.headerAccountId ?? ID,
      name: 'Main',
      role: 'receiver',
      browserProfile: `persist:poolside-${ID}`,
      cookieCount: payload.cookies.length,
      savedAt: '2026-09-18T00:00:00.000Z',
      secret: options.corrupt ? '' : Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    })
  );
  return file;
}

test('initialising establishes storage once and counts the generation', () => {
  withWorkspace(({ root, manager }) => {
    const first = manager.initialise(fresh());
    assert.equal(first.generation, 1);
    assert.equal(first.action, 'created');
    assert.equal(profileOf().generation, 1, 'the counter is persisted, not just returned');
    assert.ok(profileOf().firstSeenAt, 'and so is when it was first seen');
    assert.equal(fs.existsSync(path.join(root, 'Partitions')), true);
    assert.equal(fs.existsSync(path.join(root, 'accounts')), true);

    const second = manager.initialise(fresh());
    assert.equal(second.generation, 1, 'an ordinary open does not inflate the counter');
    assert.equal(second.action, 'unchanged');
  });
});

test('a profile that has disappeared is re-created and the generation moves on', () => {
  withWorkspace(({ root, manager }) => {
    manager.initialise(fresh());
    fs.mkdirSync(profileDirectory(root, ID), { recursive: true });
    assert.equal(manager.initialise(fresh()).generation, 1, 'still present: no change');
    fs.rmSync(profileDirectory(root, ID), { recursive: true, force: true });
    const after = manager.initialise(fresh());
    assert.equal(after.action, 're-created');
    assert.equal(after.generation, 2);
  });
});

test('a pre-existing profile with no record is adopted rather than claimed as new', () => {
  withWorkspace(({ root, manager }) => {
    fs.mkdirSync(profileDirectory(root, ID), { recursive: true });
    const result = manager.initialise(fresh());
    assert.equal(result.action, 'adopted');
    assert.equal(result.generation, 1);
  });
});

test('the scan quarantines a damaged file and records the history on the account', () => {
  withWorkspace(({ root, manager }) => {
    const file = writeCarryOver(root, { corrupt: true });
    const result = manager.scan(workspace.data.accounts);
    assert.equal(result.summary.corrupt, 1);
    assert.equal(fs.existsSync(file), false, 'the unreadable file is moved out of the read path');
    const record = profileOf().corruption;
    assert.ok(record, 'the corruption history was written');
    assert.equal(record.count, 1);
    assert.equal(record.lastAction, 'quarantined');
    assert.match(String(record.lastReason), /no encrypted session payload/);
    assert.ok(record.lastAt, 'the history carries when it happened');
  });
});

test('corruption history accumulates rather than resetting', () => {
  withWorkspace(({ root, manager }) => {
    writeCarryOver(root, { corrupt: true });
    manager.scan(workspace.data.accounts);
    writeCarryOver(root, { payload: { version: 9, accountId: ID, cookies: [] } });
    manager.scan(workspace.data.accounts);
    const history = profileOf().corruption;
    assert.ok(history, 'the history survives the second scan');
    assert.equal(history.count, 2);
    assert.match(String(history.lastReason), /version 9/);
  });
});

test('the scan leaves a healthy account alone and reports a clean summary', () => {
  withWorkspace(({ root, manager }) => {
    const file = writeCarryOver(root);
    const result = manager.scan(workspace.data.accounts);
    assert.equal(result.summary.ok, 1);
    assert.equal(fs.existsSync(file), true);
    assert.equal(fresh().profile, undefined, 'nothing at all is recorded for a healthy file');
  });
});

test('the sweep removes unclaimed storage and leaves everything else alone', () => {
  withWorkspace(({ root, manager }) => {
    // Unclaimed: a partition directory and a cookie file for an account that is not in the document.
    fs.mkdirSync(profileDirectory(root, OTHER), { recursive: true });
    fs.mkdirSync(path.dirname(carryOverFile(root, OTHER)), { recursive: true });
    fs.writeFileSync(carryOverFile(root, OTHER), 'stale');
    // Not ours: a Chromium directory and an unrecognised file name.
    fs.mkdirSync(path.join(root, 'Partitions', 'Shared Dictionary'), { recursive: true });
    fs.writeFileSync(path.join(root, 'accounts', 'notes.txt'), 'mine');
    // Ours and claimed: this account's own storage.
    fs.mkdirSync(profileDirectory(root, ID), { recursive: true });

    manager.scan(workspace.data.accounts);
    assert.equal(fs.existsSync(profileDirectory(root, OTHER)), false, 'an unclaimed profile is removed');
    assert.equal(fs.existsSync(carryOverFile(root, OTHER)), false);
    assert.equal(fs.existsSync(path.join(root, 'Partitions', 'Shared Dictionary')), true, "Chromium's directory is not ours to delete");
    assert.equal(fs.existsSync(path.join(root, 'accounts', 'notes.txt')), true, "an unrecognised name may be the user's own backup");
    assert.equal(fs.existsSync(profileDirectory(root, ID)), true, 'a claimed profile is never swept');
  });
});

test('an archived account keeps its profile, because it is still in the document', () => {
  withWorkspace(({ root, manager }) => {
    fs.mkdirSync(profileDirectory(root, ID), { recursive: true });
    workspace.data.accounts[0] = { ...fresh(), archived: true };
    manager.scan(workspace.data.accounts);
    assert.equal(fs.existsSync(profileDirectory(root, ID)), true, 'archiving must not be a silent data loss');
  });
});

test('measuring reports disk usage against the configured ceiling', () => {
  withWorkspace(({ root, manager }) => {
    manager.initialise(fresh());
    fs.mkdirSync(profileDirectory(root, ID), { recursive: true });
    fs.writeFileSync(path.join(profileDirectory(root, ID), 'cache.bin'), 'x'.repeat(2048));
    workspace.data.accounts[0] = { ...fresh(), identity: { quotaBytes: 1024 } };
    manager.measure(workspace.data.accounts);
    const snapshot = profileReports.get(ID);
    assert.ok(snapshot, 'the measurement was stored for the snapshot to carry');
    assert.equal(snapshot.directoryBytes, 2048);
    assert.equal(snapshot.quotaBytes, 1024, 'the ceiling comes from the same identity config the session uses');
    assert.equal(snapshot.overQuota, true);
    assert.equal(profileOf().generation, 1, 'measuring does not disturb the durable bookkeeping');
  });
});

test('deleting a profile removes its storage and its record', () => {
  withWorkspace(async ({ root, manager }) => {
    manager.initialise(fresh());
    const file = writeCarryOver(root);
    const quarantined = `${file}.corrupt-2026-09-18T01-02-03-456Z`;
    fs.writeFileSync(quarantined, 'evidence');
    fs.mkdirSync(profileDirectory(root, ID), { recursive: true });
    fs.writeFileSync(path.join(profileDirectory(root, ID), 'cache.bin'), 'x');

    const outcome = await manager.remove(fresh());
    assert.deepEqual(outcome.failures, []);
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(quarantined), false, 'quarantined copies belong to the profile being deleted');
    assert.equal(fs.existsSync(profileDirectory(root, ID)), false);
    assert.equal(fresh().profile, undefined, 'the bookkeeping goes with it');
    assert.equal(profileReports.has(ID), false);
    assert.ok(outcome.removed.length >= 3);
  });
});

test('deleting refuses while the session is open, before touching anything', () => {
  withWorkspace(async ({ root, manager }) => {
    const file = writeCarryOver(root);
    sessions.set(ID, /** @type {any} */ ({ window: {} }));
    await assert.rejects(() => manager.remove(fresh()), /Close this session before deleting its profile/);
    assert.equal(fs.existsSync(file), true, 'a refused delete changes nothing on disk');
    sessions.clear();
    const outcome = await manager.remove(fresh());
    assert.equal(fs.existsSync(file), false);
    assert.deepEqual(outcome.failures, []);
  });
});
