// A backup folder is the one thing Poolside reads back from outside its own data directory, so the
// refusal cases matter more than the happy path: a foreign format, a forged identifier, or a path that
// climbs out of the backup must all be stopped before anything is copied.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('../src/backup-manifest.cjs');

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const account = (over = {}) => ({
  id: ID,
  name: 'Master',
  role: 'receiver',
  archived: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  ...over
});
const document = (over = {}) => ({
  format: manifest.FORMAT,
  application: 'Poolside',
  appVersion: '0.2.0',
  exportedAt: '2026-09-20T12:00:00.000Z',
  accounts: [account()],
  files: [{ path: 'workspace.json', bytes: 12, sha256: 'abc' }],
  profiles: [{ path: 'profiles/poolside-11111111-1111-4111-8111-111111111111', files: 3, bytes: 90 }],
  ...over
});

test('a manifest round-trips through build and parse', () => {
  const built = manifest.build(document());
  assert.equal(built.format, 'poolside-backup/v1');
  assert.equal(built.application, 'Poolside');
  assert.match(built.note, /same Windows account/);
  const parsed = manifest.parse(built);
  assert.deepEqual(parsed.accounts, [account()]);
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.profiles.length, 1);
});

test('a folder that is not one of ours is refused with a sentence that names what it found', () => {
  assert.throws(() => manifest.parse(null), /not a Poolside backup/);
  assert.throws(() => manifest.parse({}), /not a Poolside backup/);
  assert.throws(() => manifest.parse({ format: 'chrome-cookies/v1' }), /chrome-cookies\/v1/);
  assert.throws(() => manifest.parse(document({ format: 'poolside-backup/v2' })), /poolside-backup\/v2/);
  assert.throws(() => manifest.parse(document({ accounts: [] })), /does not contain any accounts/);
});

test('a manifest that names something Poolside did not issue is refused', () => {
  assert.throws(() => manifest.parse(document({ accounts: [account({ id: '../../etc' })] })), /did not issue/);
  assert.throws(() => manifest.parse(document({ accounts: [account({ role: 'admin' })] })), /unknown role/);
  assert.throws(() => manifest.parse(document({ accounts: [account({ name: '' })] })), /without a usable name/);
  assert.throws(() => manifest.parse(document({ accounts: [account(), account()] })), /same account twice/);
});

test('an entry that points outside the backup folder is dropped rather than followed', () => {
  const parsed = manifest.parse(
    document({
      files: [
        { path: '../../secrets.txt', bytes: 1, sha256: 'x' },
        { path: 'C:\\Windows\\win.ini', bytes: 1, sha256: 'x' },
        { path: 'sessions/ok.plist', bytes: 1, sha256: 'x' }
      ],
      profiles: [{ path: '../..', files: 1, bytes: 1 }]
    })
  );
  assert.deepEqual(
    parsed.files.map(entry => entry.path),
    ['sessions/ok.plist']
  );
  assert.deepEqual(parsed.profiles, []);
});

test('a restore adds what is missing and reports what is already here', () => {
  const parsed = manifest.parse(document({ accounts: [account(), account({ id: OTHER, name: 'Slave', role: 'sender' })] }));
  const decision = manifest.plan(parsed, [{ id: ID, name: 'Master', role: 'receiver' }]);
  assert.deepEqual(
    decision.importable.map(a => a.name),
    ['Slave']
  );
  assert.deepEqual(decision.present, ['Master']);
  assert.deepEqual(decision.conflicts, []);
});

test('a restored name that is already taken is renamed instead of colliding', () => {
  const parsed = manifest.parse(document({ accounts: [account({ id: OTHER, name: 'Master', role: 'sender' })] }));
  const decision = manifest.plan(parsed, [{ id: ID, name: 'Master', role: 'receiver' }]);
  assert.deepEqual(
    decision.importable.map(a => a.name),
    ['Master (2)']
  );
});

test('a second receiving account is reported, not quietly demoted to a different role', () => {
  const parsed = manifest.parse(document({ accounts: [account({ id: OTHER, name: 'Spare', role: 'receiver' })] }));
  const decision = manifest.plan(parsed, [{ id: ID, name: 'Master', role: 'receiver' }]);
  assert.deepEqual(decision.importable, []);
  assert.deepEqual(decision.conflicts, [{ name: 'Spare', reason: 'this workspace already has a receiving account' }]);
  // An archived receiver does not hold the slot, so a live one from the backup may take it.
  const free = manifest.plan(parsed, [{ id: ID, name: 'Master', role: 'receiver', archived: true }]);
  assert.deepEqual(
    free.importable.map(a => a.name),
    ['Spare']
  );
});
