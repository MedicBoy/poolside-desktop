// The backup round trip, exercised against real directories. The point of these tests is not that the
// copy works — it is that a restore into a workspace that already owns an account, or already holds a
// profile directory, changes nothing rather than overwriting live storage.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const backup = require('../src/workspace-backup.cjs');
const model = require('../src/model.cjs');
const manifest = require('../src/backup-manifest.cjs');
const { ACCOUNTS_DIR, PARTITIONS_DIR, partitionName } = require('../src/profile-paths.cjs');

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-backup-test-'));
}

/** A data directory with one signed-in account: a workspace file, a carry-over file, and a profile. */
function sourceRoot() {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'workspace.json'), JSON.stringify({ version: 1, accounts, settings: { table: 'London', limit: 1 } }));
  fs.mkdirSync(path.join(root, ACCOUNTS_DIR), { recursive: true });
  fs.writeFileSync(path.join(root, ACCOUNTS_DIR, `${ID}.plist`), '<plist>encrypted</plist>');
  const profile = path.join(root, PARTITIONS_DIR, partitionName(ID), 'Cookies');
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'data'), 'chromium state');
  return root;
}

const accounts = [{ id: ID, name: 'Master', role: 'receiver', archived: false, createdAt: '2026-09-01T00:00:00.000Z' }];

test('a backup carries the workspace file, the encrypted session, and the browser profile', () => {
  const root = sourceRoot();
  const destination = tempRoot();
  const result = backup.create({ root, destination, accounts, appVersion: '0.2.0', at: Date.parse('2026-09-20T12:00:00Z') });
  assert.equal(result.accountCount, 1);
  assert.equal(result.sessionCount, 1);
  assert.equal(result.profileCount, 1);
  assert.ok(result.bytes > 0);
  assert.equal(path.basename(result.folder), 'Poolside-backup-2026-09-20-120000');
  const doc = manifest.parse(JSON.parse(fs.readFileSync(path.join(result.folder, 'manifest.json'), 'utf8')));
  assert.deepEqual(doc.files.map(entry => entry.path).sort(), ['sessions/11111111-1111-4111-8111-111111111111.plist', 'workspace.json']);
  assert.match(doc.profiles[0].sha256, /^[a-f0-9]{64}$/);
  assert.ok(fs.existsSync(path.join(result.folder, backup.PROFILES_DIR, partitionName(ID), 'Cookies', 'data')));
});

test('a backup keeps proxy targets but never exports their credentials', () => {
  const root = sourceRoot();
  fs.writeFileSync(
    path.join(root, 'workspace.json'),
    JSON.stringify({
      version: 1,
      accounts: [{ ...accounts[0], proxy: { spec: 'http://nicho:hunter2@proxy.example:3128' } }],
      settings: { table: 'London', limit: 1, proxy: { spec: 'global:secret@127.0.0.1:8080' } },
      routePresets: [{ spec: 'preset:secret@10.0.0.1:9000' }]
    })
  );
  const destination = tempRoot();
  const result = backup.create({ root, destination, accounts, appVersion: '0.2.0', at: Date.now() });
  const exported = fs.readFileSync(path.join(result.folder, 'workspace.json'), 'utf8');
  assert.equal(exported.includes('hunter2'), false);
  assert.equal(exported.includes('secret'), false);
  assert.match(exported, /http:\/\/proxy\.example:3128/);
  assert.match(exported, /127\.0\.0\.1:8080/);
});

test('an unreadable workspace is refused instead of exported as a usable backup', () => {
  const root = sourceRoot();
  fs.writeFileSync(path.join(root, 'workspace.json'), JSON.stringify({ version: 1, accounts, settings: { table: 'Unknown', limit: 1 } }));
  assert.throws(
    () => backup.create({ root, destination: tempRoot(), accounts, appVersion: '0.2.0', at: Date.now() }),
    /workspace file could not be safely included/
  );
});

test('a restore into an empty data directory brings the account and its profile back', () => {
  const source = tempRoot();
  const bundle = backup.create({ root: sourceRoot(), destination: source, accounts, appVersion: '0.2.0', at: Date.now() }).folder;
  const target = tempRoot();
  const result = backup.restore({ root: target, source: bundle, existing: [] });
  assert.deepEqual(
    result.restored.map(account => account.name),
    ['Master']
  );
  assert.deepEqual(result.present, []);
  assert.equal(fs.readFileSync(path.join(target, ACCOUNTS_DIR, `${ID}.plist`), 'utf8'), '<plist>encrypted</plist>');
  assert.equal(fs.readFileSync(path.join(target, PARTITIONS_DIR, partitionName(ID), 'Cookies', 'data'), 'utf8'), 'chromium state');
});

test('restoring the same backup twice adds nothing the second time', () => {
  const source = tempRoot();
  const bundle = backup.create({ root: sourceRoot(), destination: source, accounts, appVersion: '0.2.0', at: Date.now() }).folder;
  const target = tempRoot();
  const first = backup.restore({ root: target, source: bundle, existing: [] });
  const second = backup.restore({ root: target, source: bundle, existing: first.restored });
  assert.deepEqual(second.restored, []);
  assert.deepEqual(second.present, ['Master']);
});

test('a restore never overwrites browser storage this PC already holds', () => {
  const source = tempRoot();
  const bundle = backup.create({ root: sourceRoot(), destination: source, accounts, appVersion: '0.2.0', at: Date.now() }).folder;
  const target = tempRoot();
  const live = path.join(target, PARTITIONS_DIR, partitionName(ID), 'Cookies');
  fs.mkdirSync(live, { recursive: true });
  fs.writeFileSync(path.join(live, 'data'), 'this PC’s own state');
  assert.throws(() => backup.restore({ root: target, source: bundle, existing: [] }), /already has saved browser storage/);
  assert.equal(fs.readFileSync(path.join(live, 'data'), 'utf8'), 'this PC’s own state');
});

test('a conflict in a later account leaves earlier accounts untouched', () => {
  const root = sourceRoot();
  const otherProfile = path.join(root, PARTITIONS_DIR, partitionName(OTHER), 'Cookies');
  fs.mkdirSync(otherProfile, { recursive: true });
  fs.writeFileSync(path.join(otherProfile, 'data'), 'other state');
  const destination = tempRoot();
  const second = { id: OTHER, name: 'Second', role: 'sender', archived: false, createdAt: '2026-09-01T00:00:00.000Z' };
  const bundle = backup.create({ root, destination, accounts: [...accounts, second], appVersion: '0.2.0', at: Date.now() }).folder;
  const target = tempRoot();
  const conflict = path.join(target, PARTITIONS_DIR, partitionName(OTHER));
  fs.mkdirSync(conflict, { recursive: true });
  assert.throws(() => backup.restore({ root: target, source: bundle, existing: [] }), /already has saved browser storage/);
  assert.equal(fs.existsSync(path.join(target, PARTITIONS_DIR, partitionName(ID))), false);
  assert.equal(fs.existsSync(path.join(target, ACCOUNTS_DIR, `${ID}.plist`)), false);
});

test('a failed workspace commit rolls back only the newly restored profile and session', () => {
  const destination = tempRoot();
  const bundle = backup.create({ root: sourceRoot(), destination, accounts, appVersion: '0.2.0', at: Date.now() }).folder;
  const target = tempRoot();
  assert.throws(
    () =>
      backup.restore({
        root: target,
        source: bundle,
        existing: [],
        commit: () => {
          throw new Error('workspace save failed');
        }
      }),
    /workspace save failed/
  );
  assert.equal(fs.existsSync(path.join(target, PARTITIONS_DIR, partitionName(ID))), false);
  assert.equal(fs.existsSync(path.join(target, ACCOUNTS_DIR, `${ID}.plist`)), false);
});

test('a damaged backup is refused before anything is written', () => {
  const source = tempRoot();
  const result = backup.create({ root: sourceRoot(), destination: source, accounts, appVersion: '0.2.0', at: Date.now() });
  const session = path.join(result.folder, backup.SESSIONS_DIR, `${ID}.plist`);
  fs.writeFileSync(session, '<plist>corrupted</plist>');
  const target = tempRoot();
  assert.throws(() => backup.restore({ root: target, source: result.folder, existing: [] }), /does not match its recorded checksum/);
  assert.equal(fs.existsSync(path.join(target, PARTITIONS_DIR, partitionName(ID))), false);
});

test('a backup workspace with a valid checksum but invalid schema is refused before restore', () => {
  const destination = tempRoot();
  const bundle = backup.create({ root: sourceRoot(), destination, accounts, appVersion: '0.2.0', at: Date.now() }).folder;
  const workspaceFile = path.join(bundle, 'workspace.json');
  const data = JSON.parse(fs.readFileSync(workspaceFile, 'utf8'));
  data.settings.table = 'Unknown';
  fs.writeFileSync(workspaceFile, JSON.stringify(data));
  const record = JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json'), 'utf8'));
  const { createHash } = require('node:crypto');
  const entry = record.files.find(file => file.path === 'workspace.json');
  entry.bytes = fs.statSync(workspaceFile).size;
  entry.sha256 = createHash('sha256').update(fs.readFileSync(workspaceFile)).digest('hex');
  fs.writeFileSync(path.join(bundle, 'manifest.json'), JSON.stringify(record));
  const target = tempRoot();
  assert.throws(() => backup.restore({ root: target, source: bundle, existing: [] }), /unreadable workspace file/);
  assert.equal(fs.existsSync(path.join(target, PARTITIONS_DIR, partitionName(ID))), false);
});

test('changing a browser profile without changing its size is detected', () => {
  const destination = tempRoot();
  const bundle = backup.create({ root: sourceRoot(), destination, accounts, appVersion: '0.2.0', at: Date.now() }).folder;
  const profile = path.join(bundle, backup.PROFILES_DIR, partitionName(ID), 'Cookies', 'data');
  fs.writeFileSync(profile, 'tampered state');
  const target = tempRoot();
  assert.throws(() => backup.restore({ root: target, source: bundle, existing: [] }), /recorded checksum/);
  assert.equal(fs.existsSync(path.join(target, PARTITIONS_DIR, partitionName(ID))), false);
});

test('an existing session file is a conflict, even when its profile is absent', () => {
  const destination = tempRoot();
  const bundle = backup.create({ root: sourceRoot(), destination, accounts, appVersion: '0.2.0', at: Date.now() }).folder;
  const target = tempRoot();
  const session = path.join(target, ACCOUNTS_DIR, `${ID}.plist`);
  fs.mkdirSync(path.dirname(session), { recursive: true });
  fs.writeFileSync(session, 'existing');
  assert.throws(() => backup.restore({ root: target, source: bundle, existing: [] }), /already has a saved session/);
  assert.equal(fs.readFileSync(session, 'utf8'), 'existing');
  assert.equal(fs.existsSync(path.join(target, PARTITIONS_DIR, partitionName(ID))), false);
});

test('a folder with no manifest is refused as not a backup', () => {
  const target = tempRoot();
  assert.throws(() => backup.restore({ root: target, source: tempRoot(), existing: [] }), /not a Poolside backup/);
});

test('a backup of an account whose files are absent still writes a usable manifest', () => {
  const destination = tempRoot();
  const result = backup.create({
    root: tempRoot(),
    destination,
    accounts: [{ id: OTHER, name: 'Slave', role: 'sender', archived: true, createdAt: '' }],
    appVersion: '0.2.0',
    at: Date.now()
  });
  assert.equal(result.accountCount, 1);
  assert.equal(result.sessionCount, 0);
  assert.equal(result.profileCount, 0);
  const doc = manifest.parse(JSON.parse(fs.readFileSync(path.join(result.folder, 'manifest.json'), 'utf8')));
  assert.equal(doc.accounts[0].archived, true);
});

test('a backup is checked before anything is copied, and says what is wrong with the folder', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-preflight-root-'));
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-preflight-out-'));
  try {
    const account = model.account({ name: 'Newfie', role: 'receiver' });
    // Nothing written yet: a workspace file and one small session file are all there is to measure.
    fs.mkdirSync(path.join(root, 'accounts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'accounts', account.id + '.plist'), 'x'.repeat(2048));
    fs.writeFileSync(path.join(root, 'workspace.json'), '{}');

    const good = backup.preflight({ root, destination, accounts: [account] }, { freeBytes: () => 1e9 });
    assert.equal(good.ok, true);
    assert.equal(good.problems.length, 0);
    assert.equal(good.accountCount, 1);
    assert.ok(good.estimateBytes > 2048, 'the estimate covers what the profile and session files measure');
    assert.match(/** @type {string} */ (good.folder), /Poolside-backup-/);
    assert.equal(good.freeBytes, 1e9);

    // Not enough room: the estimate carries a tenth of margin, so the answer is not 'exactly enough'.
    const tight = backup.preflight({ root, destination, accounts: [account] }, { freeBytes: () => 1024 });
    assert.equal(tight.ok, false);
    assert.match(tight.problems.join(' '), /There is not enough room: the backup needs about \d+ MB and 0 MB is free on that drive\./);

    // A folder that does not exist, and one inside the data root: both refused with the reason.
    const missing = backup.preflight({ root, destination: path.join(destination, 'nope'), accounts: [account] }, { freeBytes: () => 1e9 });
    assert.match(missing.problems.join(' '), /Choose an existing folder for the backup\./);
    // A folder *inside* the data root: a backup stored inside the thing it backs up is not a backup.
    const insideRoot = path.join(root, 'backup-here');
    fs.mkdirSync(insideRoot, { recursive: true });
    const inside = backup.preflight({ root, destination: insideRoot, accounts: [account] }, { freeBytes: () => 1e9 });
    assert.match(inside.problems.join(' '), /a backup stored inside what it backs up is not a backup/);

    // An account with a window open is noted rather than silently copied mid-flight.
    const open = backup.preflight({ root, destination, accounts: [account], openAccounts: ['Newfie'] }, { freeBytes: () => 1e9 });
    assert.equal(open.ok, true);
    assert.match(open.notes.join(' '), /Newfie has a window open; a browser profile that is running is copied as it stands/);

    // Free space that cannot be read is a note, not a refusal.
    const unknown = backup.preflight({ root, destination, accounts: [account] }, { freeBytes: () => null });
    assert.equal(unknown.ok, true);
    assert.match(unknown.notes.join(' '), /free space on that drive could not be read/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
  }
});

test('two backups made in the same second get their own folders rather than merging', () => {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-unique-'));
  try {
    const first = backup.uniqueFolder(destination, '2026-09-22-000000');
    fs.mkdirSync(first, { recursive: true });
    const second = backup.uniqueFolder(destination, '2026-09-22-000000');
    assert.notEqual(second, first);
    assert.match(second, /-2$/);
  } finally {
    fs.rmSync(destination, { recursive: true, force: true });
  }
});
