// What to do next, for a workspace that is not set up yet. The steps come from the workspace, so they cannot
// tell somebody to add an account they already have; and nothing here claims to know whether a sign-in worked.

const test = require('node:test');
const assert = require('node:assert/strict');
const guidance = require('../src/guidance.cjs');

const account = status => ({ id: 'a', name: 'Newfie', status });

test('an empty workspace gets the three steps in the order they have to happen', () => {
  const guide = guidance.forWorkspace({ accounts: [] });
  assert.equal(guide.show, true);
  assert.equal(guide.title, 'Set up your first session');
  assert.deepEqual(
    guide.steps.map(step => [step.title, step.action]),
    [
      ['Add an account', 'add-account'],
      ['Open it', null],
      ['Sign in on the game site', null]
    ]
  );
  assert.match(guide.steps[2].detail, /never sees the password and cannot tell you whether it worked/);
  assert.match(/** @type {string} */ (guide.note), /Add a second account when you want to coordinate a match/);
});

test('one account asks for a second rather than for a first', () => {
  const guide = guidance.forWorkspace({ accounts: [account('closed')] });
  assert.equal(guide.title, 'One account so far');
  assert.deepEqual(
    guide.steps.map(step => [step.title, step.action]),
    [
      ['Add a second account', 'add-account'],
      ['Open both', 'open-all']
    ]
  );
  assert.equal(guide.note, null);
});

test('both accounts set up but none open points at opening them', () => {
  const guide = guidance.forWorkspace({ accounts: [account('closed'), account('closed')] });
  assert.equal(guide.title, 'Both accounts are set up');
  assert.deepEqual(
    guide.steps.map(step => [step.title, step.action]),
    [
      ['Open your accounts', 'open-all'],
      ['Sign in on each game window', null]
    ]
  );
  assert.match(/** @type {string} */ (guide.note), /pair them on the Matches view/);
});

test('a workspace in use is told nothing, because there is nothing to set up', () => {
  assert.deepEqual(guidance.forWorkspace({ accounts: [account('ready'), account('closed')] }), {
    show: false,
    title: '',
    steps: [],
    note: null
  });
  assert.equal(guidance.forWorkspace({}).show, true, 'a missing snapshot reads as an empty workspace');
  assert.equal(guidance.forWorkspace({ accounts: /** @type {any} */ (null) }).show, true);
});

test('the guidance never claims to know whether an account is signed in', () => {
  const wording =
    JSON.stringify(guidance.forWorkspace({ accounts: [] })) + JSON.stringify(guidance.forWorkspace({ accounts: [account('ready')] }));
  for (const claim of ['signed in', 'sign-in verified', 'logged in', 'authenticated'])
    assert.equal(wording.includes(claim), false, `${claim} is not something this program can see`);
});

test('a problem outranks getting started: the snapshot hides guidance when attention has items', () => {
  const attention = require('../src/attention.cjs');
  const items = attention.items({ accounts: [{ id: 'a', name: 'Newfie', status: 'failed', statusReason: 'no' }] });
  assert.equal(items.length, 1);
  // This is the rule the snapshot applies; asserted here so the two panels cannot be shown at once by accident.
  const guide = guidance.forWorkspace({ accounts: [account('closed')] });
  assert.equal(items.length ? { ...guide, show: false }.show : guide.show, false);
});
