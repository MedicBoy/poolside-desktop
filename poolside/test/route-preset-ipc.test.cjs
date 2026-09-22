// Ticking an account in the settings list is the whole assignment story, so it is exercised through the
// same handler the dashboard calls — including the refusals, which are what keep the row honest.

const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/model.cjs');
const { registerRoutePresetIpc } = require('../src/route-preset-ipc.cjs');

/** @param {{probe?: ((spec: string) => Promise<any>)|null}} [options] */
function fixture({ probe = null } = {}) {
  const newfie = model.account({ name: 'Newfie', role: 'receiver' });
  const gmail = model.account({ name: 'Gmail', role: 'sender' }, [newfie]);
  // A document that decodes, so a test can reload it the way the application does on the next start.
  /** @type {any} */
  const workspace = {
    data: model.decode({ version: 1, accounts: [newfie, gmail], settings: { table: 'Bangkok', limit: 10 }, routePresets: [] })
  };
  const handlers = new Map();
  const messages = [];
  const sessions = new Map();
  registerRoutePresetIpc({
    handle: (name, handler) => handlers.set(name, handler),
    workspace,
    save: next => {
      workspace.data = next;
    },
    log: message => messages.push(message),
    sessions,
    probe
  });
  const call = (name, input) => handlers.get(name)(input);
  const account = name => workspace.data.accounts.find(candidate => candidate.name === name);
  return { workspace, call, account, messages, sessions };
}

test('a saved location can be ticked on for an account and ticked off again', () => {
  const { workspace, call, account, messages } = fixture();
  const london = call('route-preset:add', { name: 'London-1', spec: '198.105.121.200:6462:leucqwsr:secret', enabled: true });
  assert.equal(workspace.data.routePresets.length, 1);

  call('route-preset:assign', { id: account('Newfie').id, presetId: london.id });
  assert.equal(account('Newfie').routePresetId, london.id);
  assert.equal(Object.hasOwn(account('Gmail'), 'routePresetId'), false);
  assert.match(messages.at(-1), /Newfie: now connects from London-1\./);

  call('route-preset:assign', { id: account('Newfie').id, presetId: '' });
  // Ticked off means the key is gone, not set to an empty string, so the account falls back to the
  // workspace location instead of pointing at nothing.
  assert.equal(Object.hasOwn(account('Newfie'), 'routePresetId'), false);
  assert.match(messages.at(-1), /Newfie: uses the workspace location again\./);
});

test('an assignment is refused when the account, the location, or the session is not available', () => {
  const { call, account, sessions } = fixture();
  const london = call('route-preset:add', { name: 'London-1', spec: '198.105.121.200:6462', enabled: true });
  assert.throws(() => call('route-preset:assign', { id: 'nobody', presetId: london.id }), /Account not found\./);
  assert.throws(() => call('route-preset:assign', { id: account('Newfie').id, presetId: 'missing' }), /Choose a saved network location\./);
  sessions.set(account('Newfie').id, {});
  assert.throws(
    () => call('route-preset:assign', { id: account('Newfie').id, presetId: london.id }),
    /Close Newfie before changing where it connects from\./
  );
});

test('a location still in use by a ticked account cannot be removed', () => {
  const { workspace, call, account } = fixture();
  const london = call('route-preset:add', { name: 'London-1', spec: '31.59.20.176:6754', enabled: true });
  call('route-preset:assign', { id: account('Gmail').id, presetId: london.id });
  assert.throws(() => call('route-preset:delete', london.id), /Remove this preset from 1 account\(s\) before deleting it\./);
  call('route-preset:assign', { id: account('Gmail').id, presetId: '' });
  call('route-preset:delete', london.id);
  assert.deepEqual(workspace.data.routePresets, []);
});

test('a ticked location survives a reload and is dropped when the location itself is gone', () => {
  const { workspace, call, account } = fixture();
  const london = call('route-preset:add', { name: 'London-1', spec: '45.38.107.97:6014', enabled: true });
  assert.match(london.id, /^[0-9a-f-]{36}$/i);
  call('route-preset:assign', { id: account('Newfie').id, presetId: london.id });
  const reloaded = model.decode(workspace.data);
  assert.equal(reloaded.accounts.find(candidate => candidate.name === 'Newfie').routePresetId, london.id);
  const orphaned = model.decode({ ...workspace.data, routePresets: [] });
  assert.equal(
    Object.hasOwn(
      orphaned.accounts.find(candidate => candidate.name === 'Newfie'),
      'routePresetId'
    ),
    false
  );
});

test('editing a saved location is refused while an account that uses it is open, and saves when it is closed', () => {
  const { workspace, call, account, messages, sessions } = fixture();
  const london = call('route-preset:add', { name: 'London-1', spec: '198.105.121.200:6462:user:secret', enabled: true });
  call('route-preset:assign', { id: account('Newfie').id, presetId: london.id });
  // A live window keeps the route it was launched with, so the row must not be allowed to describe a change the
  // running session is not using — the same rule as ticking the box in the first place.
  sessions.set(account('Newfie').id, {});
  assert.throws(
    () => call('route-preset:update', { id: london.id, name: 'London-2' }),
    /Close Newfie before changing this saved location\./
  );
  sessions.delete(account('Newfie').id);

  const edited = call('route-preset:update', { id: london.id, name: 'London-2', spec: '', enabled: false });
  assert.equal(edited.name, 'London-2');
  assert.equal(edited.enabled, false);
  // The answer that goes to the page carries no credentials, and the stored address is untouched behind it.
  assert.match(edited.spec, /credentials set/);
  assert.equal(workspace.data.routePresets[0].spec, '198.105.121.200:6462:user:secret');
  assert.equal(workspace.data.routePresets[0].id, london.id);
  assert.equal(account('Newfie').routePresetId, london.id, 'an edit cannot drop the accounts that use it');
  assert.match(messages.at(-1), /Route preset London-2 updated\./);
});

test('editing with a typed address replaces the stored one, and an unknown id is refused', () => {
  const { workspace, call } = fixture();
  const london = call('route-preset:add', { name: 'London-1', spec: '198.105.121.200:6462', enabled: true });
  const edited = call('route-preset:update', { id: london.id, spec: '31.59.20.176:6754', bypass: '<local>' });
  assert.equal(workspace.data.routePresets[0].spec, '31.59.20.176:6754');
  assert.equal(workspace.data.routePresets[0].bypass, '<local>');
  assert.equal(edited.spec, '31.59.20.176:6754');
  assert.throws(() => call('route-preset:update', { id: 'nope', name: 'Anything' }), /Route preset not found\./);
});

test('trying a saved location tests the stored address by id and records what happened', async () => {
  const asked = [];
  const { workspace, call } = fixture({
    probe: async spec => {
      asked.push(spec);
      return { ok: false, message: 'Refused: check the username and password.' };
    }
  });
  const london = call('route-preset:add', { name: 'London-1', spec: '198.105.121.200:6462:user:secret', enabled: true });
  const result = await call('route-preset:test', { id: london.id });
  // The stored address is the one that was tried, and the page never had to send or receive it.
  assert.deepEqual(asked, ['198.105.121.200:6462:user:secret']);
  assert.equal(result.ok, false);
  assert.match(result.message, /Refused/);
  assert.match(result.preset.spec, /credentials set/, 'the answer carries the masked address, never the real one');
  assert.match(result.preset.health, /^Did not work/);
  const record = workspace.data.routePresets[0];
  assert.equal(record.lastResult, 'failed');
  assert.equal(record.checks, 1);
  assert.equal(record.failures.length, 1);
  assert.equal(record.spec, '198.105.121.200:6462:user:secret', 'recording a result never rewrites the address');
});

test('a saved location that answered records a success, and an unknown one is refused', async () => {
  const { call } = fixture({
    probe: async () => ({ ok: true, ip: '198.105.121.200', message: 'Worked — the address is 198.105.121.200.' })
  });
  const london = call('route-preset:add', { name: 'London-1', spec: '198.105.121.200:6462', enabled: true });
  const result = await call('route-preset:test', { id: london.id });
  assert.equal(result.ok, true);
  assert.match(result.preset.health, /^Worked/);
  await assert.rejects(() => call('route-preset:test', { id: 'nope' }), /Route preset not found\./);
});
