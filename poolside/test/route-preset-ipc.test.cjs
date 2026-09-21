// Ticking an account in the settings list is the whole assignment story, so it is exercised through the
// same handler the dashboard calls — including the refusals, which are what keep the row honest.

const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/model.cjs');
const { registerRoutePresetIpc } = require('../src/route-preset-ipc.cjs');

function fixture() {
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
    sessions
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
