const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  assertAccountId,
  assertRemovable,
  carryOverFile,
  classifyAccountEntries,
  classifyPartitionEntries,
  isInside,
  partition,
  partitionName,
  profileDirectory,
  quarantineFile
} = require('../src/profile-paths.cjs');

const ROOT = path.join('C:', 'data', 'Poolside');
const ID = 'e5b1c1b3-0000-4000-8000-000000000000';
const OTHER = 'f0e1d2c3-1111-4222-8333-444444444444';

test('an account id must be a uuid, because it becomes a path segment', () => {
  assert.equal(assertAccountId(ID), ID);
  assert.throws(() => assertAccountId('../../etc'), /Invalid account identifier/);
  assert.throws(() => assertAccountId('..'), /Invalid account identifier/);
  assert.throws(() => assertAccountId(''), /Invalid account identifier/);
  assert.throws(() => assertAccountId(null), /Invalid account identifier/);
  assert.throws(() => assertAccountId(`${ID}/../x`), /Invalid account identifier/);
});

test('the two storage locations are derived, never passed in', () => {
  assert.equal(profileDirectory(ROOT, ID), path.join(ROOT, 'Partitions', `poolside-${ID}`));
  assert.equal(carryOverFile(ROOT, ID), path.join(ROOT, 'accounts', `${ID}.plist`));
  assert.equal(partitionName(ID), `poolside-${ID}`);
  assert.equal(partition(ID), `persist:poolside-${ID}`);
  assert.throws(() => profileDirectory(ROOT, '../x'), /Invalid account identifier/);
});

test('isInside is strict: the directory itself is not inside itself', () => {
  assert.equal(isInside(ROOT, path.join(ROOT, 'accounts')), true);
  assert.equal(isInside(ROOT, path.join(ROOT, 'accounts', 'a.plist')), true);
  assert.equal(isInside(ROOT, ROOT), false, 'the root is not "inside" itself');
  assert.equal(isInside(ROOT, path.join(ROOT, '..', 'other')), false, 'a sibling is not inside');
  assert.equal(isInside(ROOT, path.join(ROOT, 'accounts', '..', '..', 'escape')), false, 'a traversing path is resolved first');
  assert.equal(isInside(ROOT, path.join('C:', 'Windows', 'System32')), false);
});

test('assertRemovable refuses anything outside the data directory', () => {
  const inside = path.join(ROOT, 'Partitions', `poolside-${ID}`);
  assert.equal(assertRemovable(ROOT, inside), inside);
  assert.throws(() => assertRemovable(ROOT, path.join(ROOT, '..', 'other')), /outside the Poolside data directory/);
  assert.throws(() => assertRemovable(ROOT, ROOT), /outside the Poolside data directory/);
  assert.throws(() => assertRemovable(ROOT, 'C:\\Windows'), /outside the Poolside data directory/);
});

test('a quarantined file keeps the damaged one and stays inside the data directory', () => {
  const at = Date.parse('2026-09-18T01:02:03.456Z');
  const destination = quarantineFile(ROOT, ID, at);
  assert.equal(path.basename(destination), `${ID}.plist.corrupt-2026-09-18T01-02-03-456Z`);
  assert.equal(isInside(ROOT, destination), true);
  assert.equal(assertRemovable(ROOT, destination), destination);
});

test("partition entries are split into ours, Chromium's, and unusable names", () => {
  const { ours, foreign, malformed } = classifyPartitionEntries([
    `poolside-${ID}`,
    'Shared Dictionary',
    'poolside-not-a-uuid',
    `poolside-${OTHER}`
  ]);
  assert.deepEqual(ours.map(entry => entry.id).sort(), [ID, OTHER].sort());
  assert.deepEqual(foreign, ['Shared Dictionary']);
  assert.deepEqual(malformed, ['poolside-not-a-uuid']);
});

test('account entries are split into carry-over files, quarantined copies, and other names', () => {
  const { ours, malformed } = classifyAccountEntries([
    `${ID}.plist`,
    `${ID}.plist.corrupt-2026-09-18T01-02-03-456Z`,
    'notes.txt',
    'random.plist'
  ]);
  assert.equal(ours.length, 2);
  assert.equal(ours[0].id, ID);
  assert.equal(ours[0].quarantined, false);
  assert.equal(ours[1].quarantined, true, "a quarantined copy is still recognised as this account's");
  assert.deepEqual(malformed.sort(), ['notes.txt', 'random.plist'].sort());
});
