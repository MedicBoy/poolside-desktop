// What a live session's own exit address is recorded against.
//
// The stronger of the two measurements: the operator's test asks a throwaway profile whether an address answers,
// while this is the session that really ran. It used to be reported once, in the activity feed, and forgotten.

const test = require('node:test');
const assert = require('node:assert/strict');
const { noteVerification } = require('../src/route-health.cjs');
const { create } = require('../src/route-presets.cjs');

const AT = Date.parse('2026-09-22T10:00:00Z');

function fixture() {
  const preset = create({ name: 'London-1', spec: '198.105.121.200:6462:user:secret' }, []);
  /** @type {any} */
  const workspace = { data: { version: 1, accounts: [], settings: {}, routePresets: [preset] } };
  const messages = [];
  let saves = 0;
  return {
    preset,
    workspace,
    messages,
    get saves() {
      return saves;
    },
    /** @param {any} account @param {any} verified @param {number} [at] */
    note: (account, verified, at = AT) =>
      noteVerification({
        workspace,
        save: next => {
          workspace.data = next;
          saves += 1;
        },
        log: (message, level) => messages.push({ message, level }),
        account,
        verified,
        at
      })
  };
}

test('a session that really used the location records it as working', () => {
  const { note, workspace, messages, preset } = fixture();
  const result = note(
    { id: 'a', name: 'Newfie', routePresetId: preset.id },
    { ok: true, matches: true, route: { label: 'http proxy at 198.105.121.200:6462' } }
  );
  assert.equal(result?.ok, true);
  assert.equal(workspace.data.routePresets[0].lastResult, 'ok');
  assert.equal(workspace.data.routePresets[0].checks, 1);
  assert.deepEqual(workspace.data.routePresets[0].failures, []);
  // A working route is not worth a line in the journal: the row already says it, and a line per window open would
  // bury the ones that matter.
  assert.deepEqual(messages, []);
});

test('a session that left through somewhere else records the mismatch, and says which address it reported', () => {
  const { note, workspace, messages, preset } = fixture();
  const result = note(
    { id: 'b', name: 'Gmail', routePresetId: preset.id },
    { ok: true, matches: false, route: { label: 'http proxy at 31.59.20.176:6754' } }
  );
  assert.equal(result?.ok, false);
  const record = workspace.data.routePresets[0];
  assert.equal(record.lastResult, 'failed');
  assert.equal(record.failures.length, 1);
  assert.match(record.lastDetail, /reported http proxy at 31\.59\.20\.176:6754 instead/);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].level, 'warning');
  assert.match(messages[0].message, /^Gmail: London-1 — the session reported .* instead\.$/);
  // The address the operator pasted is still exactly where it was: recording an outcome never rewrites the route.
  assert.equal(record.spec, '198.105.121.200:6462:user:secret');
});

test('an exit address that could not be read is recorded as unread, not as a failure of the address', () => {
  const { note, workspace } = fixture();
  const result = note({ id: 'c', name: 'Newfie', routePresetId: workspace.data.routePresets[0].id }, { ok: false, error: 'tunnel failed' });
  assert.equal(result?.ok, false);
  assert.match(workspace.data.routePresets[0].lastDetail, /could not be read/);
  assert.doesNotMatch(workspace.data.routePresets[0].lastDetail, /tunnel failed/, 'a transport error is not the address being wrong');
});

test('a session with no saved location of its own records nothing at all', () => {
  const { note, workspace, saves } = fixture();
  // The workspace default, and an account whose saved location has been removed: neither has a row to write on,
  // and inventing one would blame a location the account is not using.
  assert.equal(note({ id: 'd', name: 'Newfie' }, { ok: true, matches: true, route: { label: 'x' } }), null);
  assert.equal(note({ id: 'e', name: 'Gmail', routePresetId: 'f0e1d2c3-1111-4222-8333-444444444444' }, { ok: true, matches: true }), null);
  assert.equal(saves, 0, 'nothing was written');
  assert.deepEqual(workspace.data.routePresets[0].failures, undefined);
});

test('junk in the verification result is treated as an unread address rather than throwing', () => {
  const { note, workspace } = fixture();
  const id = workspace.data.routePresets[0].id;
  for (const verified of [null, undefined, {}, { ok: 'yes' }, { ok: false }]) {
    assert.doesNotThrow(() => note({ id: 'f', name: 'Newfie', routePresetId: id }, verified));
  }
  assert.equal(workspace.data.routePresets[0].lastResult, 'failed');
});
