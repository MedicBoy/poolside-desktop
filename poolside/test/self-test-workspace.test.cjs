const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rootName, isSelfTestRoot, staleRoots, PREFIX, STALE_AFTER_MS } = require('../src/self-test-workspace.cjs');

test('a self-test user-data name is unique per run, even when the process id repeats', () => {
  const first = rootName(Date.parse('2026-09-21T12:00:00.000Z'), 9072);
  const later = rootName(Date.parse('2026-09-21T12:00:01.000Z'), 9072);
  assert.notEqual(first, later, 'the same process id at a different time is a different directory');
  assert.ok(first.startsWith(PREFIX));
  assert.equal(isSelfTestRoot(first), true);
});

test('only self-test directories are ever considered for sweeping', () => {
  assert.equal(isSelfTestRoot('poolside-test-9072-abc'), true);
  assert.equal(isSelfTestRoot(PREFIX), false, 'the bare prefix is not a directory a run made');
  for (const name of ['poolside', 'poolside-accounts', 'other-test-1', '', null, undefined, 42])
    assert.equal(isSelfTestRoot(name), false, `${String(name)} must not match`);
});

test('a sweep takes only the directories an abandoned run left behind', () => {
  const now = Date.parse('2026-09-21T12:00:00.000Z');
  const entries = [
    { name: 'poolside-test-1-old', modifiedMs: now - STALE_AFTER_MS - 1 },
    { name: 'poolside-test-2-justnow', modifiedMs: now - 1000 },
    { name: 'poolside-test-3-boundary', modifiedMs: now - STALE_AFTER_MS },
    { name: 'unrelated-directory', modifiedMs: now - STALE_AFTER_MS * 10 },
    { name: 'poolside-test-4-unknown-age', modifiedMs: Number.NaN }
  ];
  assert.deepEqual(staleRoots(entries, { now }), ['poolside-test-1-old', 'poolside-test-3-boundary']);
  assert.deepEqual(staleRoots(entries, { now, olderThanMs: 0 }), [
    'poolside-test-1-old',
    'poolside-test-2-justnow',
    'poolside-test-3-boundary'
  ]);
  assert.deepEqual(staleRoots([], { now }), []);
  assert.deepEqual(staleRoots(null, { now }), []);
});
