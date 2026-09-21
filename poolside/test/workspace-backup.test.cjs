// The backup round trip, exercised against real directories. The point of these tests is not that the
// copy works — it is that a restore into a workspace that already owns an account, or already holds a
// profile directory, changes nothing rather than overwriting live storage.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const backup = require('../src/workspace-backup.cjs');
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
  fs.writeFileSync(path.join(root, 'workspace.json'), JSON.stringify({ version: 1, accounts: [{ id: ID, name: 'Master' }] }));
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
  assert.ok(fs.existsSync(path.join(result.folder, backup.PROFILES_DIR, partitionName(ID), 'Cookies', 'data')));
});

test('a backup keeps proxy targets but never exports their credentials', () => {
  const root = sourceRoot();
  fs.writeFileSync(
    path.join(root, 'workspace.json'),
    JSON.stringify({
      version: 1,
      accounts: [{ id: ID, name: 'Master', proxy: { spec: 'http://nicho:hunter2@proxy.example:3128' } }],
      settings: { proxy: { spec: 'global:secret@127.0.0.1:8080' } },
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

test('a damaged backup is refused before anything is written', () => {
  const source = tempRoot();
  const result = backup.create({ root: sourceRoot(), destination: source, accounts, appVersion: '0.2.0', at: Date.now() });
  const session = path.join(result.folder, backup.SESSIONS_DIR, `${ID}.plist`);
  fs.writeFileSync(session, '<plist>tampered</plist>');
  const target = tempRoot();
  assert.throws(() => backup.restore({ root: target, source: result.folder, existing: [] }), /does not match its recorded checksum/);
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
