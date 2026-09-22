// What the two accounts of a match are configured to look like.
//
// Every assertion here is about **configuration**, never observation: this module never reads a page, so it may
// never say what a session reports. Where it speaks, it says what the stored settings are and what that means.

const test = require('node:test');
const assert = require('node:assert/strict');
const { notes } = require('../src/participant-contrast.cjs');

const account = (id, name, extra = {}) => ({ id, name, role: 'sender', archived: false, ...extra });
const preset = (id, name) => ({ id, name, spec: '198.105.121.200:6462', enabled: true, bypass: '' });
const participants = (...ids) => ids.map(id => ({ id, name: id === 'a' ? 'Newfie' : 'Gmail' }));

test('neither account having an identity of its own is stated, and points at the comparison', () => {
  const list = notes({ participants: participants('a', 'b'), accounts: [account('a', 'Newfie'), account('b', 'Gmail')], routePresets: [] });
  const identity = list.find(entry => entry.code === 'no-identity');
  assert.ok(identity, 'the fact is stated');
  assert.match(identity.text, /Neither Newfie nor Gmail has an identity of its own/);
  assert.match(identity.text, /Sessions view can compare what they actually report/);
  // Configuration, not observation: nothing claims what the sessions report or that they look alike.
  assert.doesNotMatch(identity.text, /look like one machine|report the same values as each other|identical/);
});

test('one account with an identity of its own is enough to stop saying it', () => {
  const list = notes({
    participants: participants('a', 'b'),
    accounts: [account('a', 'Newfie', { identity: { timezone: 'America/St_Johns' } }), account('b', 'Gmail')],
    routePresets: []
  });
  assert.deepEqual(list, [], 'nothing worth saying when the two are configured differently');
  // An identity object that is present but empty is not an identity: it configures nothing.
  const empty = notes({
    participants: participants('a', 'b'),
    accounts: [account('a', 'Newfie', { identity: {} }), account('b', 'Gmail', { identity: {} })],
    routePresets: []
  });
  assert.equal(
    empty.some(entry => entry.code === 'no-identity'),
    true
  );
});

test('both accounts on the same saved location is said plainly, with what it means', () => {
  const london = preset('p1', 'London-1');
  const list = notes({
    participants: participants('a', 'b'),
    accounts: [
      account('a', 'Newfie', { identity: { timezone: 'America/St_Johns' }, routePresetId: 'p1' }),
      account('b', 'Gmail', { identity: { timezone: 'America/St_Johns' }, routePresetId: 'p1' })
    ],
    routePresets: [london]
  });
  const same = list.find(entry => entry.code === 'same-location');
  assert.ok(same);
  assert.match(same.text, /Both accounts use London-1, so they leave from the same address/);
  assert.match(same.text, /Two different exits need two saved locations/);
  assert.equal(list.length, 1, 'the identity note is not needed when both carry one');
});

test('one account located and the other not is the case that says "may leave from the same address"', () => {
  const list = notes({
    participants: participants('a', 'b'),
    accounts: [
      account('a', 'Newfie', { identity: { timezone: 'America/St_Johns' }, routePresetId: 'p1' }),
      account('b', 'Gmail', { identity: { timezone: 'Europe/London' } })
    ],
    routePresets: [preset('p1', 'London-1')]
  });
  assert.equal(list.length, 1);
  assert.equal(list[0].code, 'mixed-location');
  assert.match(list[0].text, /Newfie \(London-1\) uses a saved location, and Gmail uses whatever is set for the workspace/);
  assert.match(list[0].text, /may leave from the same address/);
});

test('two different saved locations say nothing, because there is nothing to warn about', () => {
  const list = notes({
    participants: participants('a', 'b'),
    accounts: [
      account('a', 'Newfie', { identity: { timezone: 'America/St_Johns' }, routePresetId: 'p1' }),
      account('b', 'Gmail', { identity: { timezone: 'Europe/London' }, routePresetId: 'p2' })
    ],
    routePresets: [preset('p1', 'London-1'), preset('p2', 'London-2')]
  });
  assert.deepEqual(list, []);
  // Neither located is also silent: the workspace's own setting may be direct, and guessing at it would be a claim
  // from absence.
  const neither = notes({
    participants: participants('a', 'b'),
    accounts: [account('a', 'Newfie', { identity: { timezone: 'x' } }), account('b', 'Gmail', { identity: { timezone: 'y' } })],
    routePresets: [preset('p1', 'London-1')]
  });
  assert.deepEqual(neither, []);
});

test('junk is answered with silence rather than a throw', () => {
  for (const input of [undefined, null, {}, { participants: [] }, { participants: [{}] }, { participants: 'x', accounts: 'y' }])
    assert.doesNotThrow(() => notes(/** @type {any} */ (input)));
  assert.deepEqual(notes(/** @type {any} */ ({ participants: [{ id: 'missing', name: 'Ghost' }], accounts: [] })), []);
  // An account that is no longer in the workspace cannot be judged, and an unknown id does not become a note.
  const list = notes({
    participants: participants('a', 'b'),
    accounts: [account('a', 'Newfie')],
    routePresets: [preset('p1', 'London-1')]
  });
  assert.equal(list.length, 1);
  assert.equal(list[0].code, 'no-identity');
});
