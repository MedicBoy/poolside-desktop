// The rules that decide what a bulk account action is allowed to touch. Removal across a selection is
// the most destructive control in the application, so the refusal cases are pinned here rather than
// only being exercised through a click.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ACTIONS, MAX_SELECTION, selection, plan, removalPrompt } = require('../src/bulk-plan.cjs');

const accounts = [
  { id: 'a1', name: 'Master' },
  { id: 'a2', name: 'Slave' },
  { id: 'a3', name: 'Spare' }
];
const openIds = new Set(['a1']);
const isOpen = account => openIds.has(account.id);

test('the selection is validated before any work starts', () => {
  assert.deepEqual(ACTIONS, ['open', 'close', 'archive', 'delete']);
  assert.throws(() => selection({ action: 'launch', ids: ['a1'] }, accounts), /supported bulk action/);
  assert.throws(() => selection({ action: 'open', ids: [] }, accounts), /Select at least one account/);
  assert.throws(() => selection({ action: 'open', ids: ['nope'] }, accounts), /no longer exists/);
  assert.throws(() => selection(null, accounts), /supported bulk action/);
});

test('a selection larger than the cap is refused before anything is touched', () => {
  const many = Array.from({ length: MAX_SELECTION + 1 }, (_, i) => ({ id: `id-${i}`, name: `Account ${i}` }));
  assert.throws(() => selection({ action: 'open', ids: many.map(account => account.id) }, many), /100 accounts or fewer/);
  assert.equal(selection({ action: 'open', ids: many.slice(0, MAX_SELECTION).map(a => a.id) }, many).ids.length, MAX_SELECTION);
});

test('a repeated id counts once, so a duplicated request cannot double-work an account', () => {
  const picked = selection({ action: 'close', ids: ['a2', 'a2', 'a1', ''] }, accounts);
  assert.deepEqual(picked.ids, ['a2', 'a1']);
  assert.deepEqual(
    picked.accounts.map(account => account.name),
    ['Slave', 'Master']
  );
});

test('open and close act only on the accounts that are not already in that state', () => {
  const opened = plan('open', accounts, isOpen);
  assert.equal(opened.ok, true);
  assert.deepEqual(opened.ids, ['a2', 'a3']);
  assert.deepEqual(opened.skipped, ['Master']);

  const closed = plan('close', accounts, isOpen);
  assert.deepEqual(closed.ids, ['a1']);
  assert.deepEqual(closed.skipped, ['Slave', 'Spare']);
});

test('an action that would change nothing is a report, not a failure', () => {
  const alreadyOpen = plan('open', [accounts[0]], isOpen);
  assert.equal(alreadyOpen.ok, true);
  assert.deepEqual(alreadyOpen.ids, []);
  assert.deepEqual(alreadyOpen.skipped, ['Master']);
});

test('archiving and removal refuse while any selected session is open, and name it', () => {
  for (const action of /** @type {('archive'|'delete')[]} */ (['archive', 'delete'])) {
    const refused = plan(action, accounts, isOpen);
    assert.equal(refused.ok, false);
    assert.match(refused.error, /Master/);
    assert.match(refused.error, action === 'archive' ? /archiving/ : /removing/);
  }
  const allowed = plan(
    'delete',
    accounts.filter(a => a.id !== 'a1'),
    isOpen
  );
  assert.equal(allowed.ok, true);
  assert.deepEqual(allowed.ids, ['a2', 'a3']);
});

test('the removal prompt names how many accounts are destroyed and which ones', () => {
  assert.equal(removalPrompt(['Master']).title, 'Remove 1 account from Poolside?');
  assert.equal(removalPrompt(['Master', 'Slave']).title, 'Remove 2 accounts from Poolside?');
  assert.match(removalPrompt(['Master', 'Slave']).detail, /Master, Slave/);
  const many = removalPrompt(Array.from({ length: 11 }, (_, i) => `Account ${i + 1}`));
  assert.match(many.detail, /Account 8, and 3 more/);
  assert.doesNotMatch(many.detail, /Account 9/);
});
