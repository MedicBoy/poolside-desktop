const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/model.cjs');
const { registerAccountManagement } = require('../src/account-management-ipc.cjs');

function fixture() {
  const main = model.account({ name: 'Main', role: 'receiver' });
  const slave = model.account({ name: 'Slave', role: 'sender' }, [main]);
  const workspace = { data: { routePresets: [], accounts: [main, slave], windows: { [main.id]: { x: 10 }, [slave.id]: { x: 20 } } } };
  const handlers = new Map();
  const removed = [];
  registerAccountManagement({
    handle: (name, handler) => handlers.set(name, handler),
    model,
    workspace,
    sessions: new Map(),
    save: next => {
      workspace.data = next;
    },
    log: () => {},
    getAccount: id => {
      const account = workspace.data.accounts.find(candidate => candidate.id === id && !candidate.archived);
      if (!account) throw new Error('Account not found.');
      return account;
    },
    profiles: {
      remove: async account => {
        removed.push(account.id);
        return { removed: ['profile'], failures: [] };
      }
    },
    confirmDestructive: async () => true,
    activeAccounts: () => workspace.data.accounts.filter(account => !account.archived)
  });
  return { handlers, workspace, main, slave, removed };
}

test('account management archives, restores, and edits the same workspace entries that Sessions renders', () => {
  const { handlers, workspace, slave } = fixture();
  handlers.get('account:archive')(slave.id);
  const archived = workspace.data.accounts.find(account => account.id === slave.id);
  assert.ok(archived);
  assert.equal(archived.archived, true);
  handlers.get('account:restore')(slave.id);
  const restored = workspace.data.accounts.find(account => account.id === slave.id);
  assert.ok(restored);
  assert.equal(restored.archived, false);
  handlers.get('account:update')({ id: slave.id, name: 'Support', role: 'sender', note: 'Local reminder.' });
  const updated = workspace.data.accounts.find(account => account.id === slave.id);
  assert.ok(updated);
  assert.equal(updated.name, 'Support');
  assert.equal(updated.note, 'Local reminder.');
  assert.equal(updated.id, slave.id, 'renaming cannot create a second account slot');
});

test('permanent account removal clears the slot and its saved window reference only after local profile removal', async () => {
  const { handlers, workspace, slave, removed } = fixture();
  await handlers.get('account:delete')(slave.id);
  assert.deepEqual(removed, [slave.id]);
  assert.equal(
    workspace.data.accounts.some(account => account.id === slave.id),
    false
  );
  assert.equal(Object.hasOwn(workspace.data.windows, slave.id), false);
  assert.equal(Object.hasOwn(workspace.data.windows, workspace.data.accounts[0].id), true, 'other account window data survives');
});

test('a selected saved route clears an account-specific route override, and clearing it uses workspace routing', () => {
  const { handlers, workspace, slave } = fixture();
  const preset = { id: '11111111-1111-4111-8111-111111111111', name: 'Office', enabled: true, spec: '127.0.0.1:8080', bypass: '' };
  workspace.data.routePresets = /** @type {any} */ ([preset]);
  workspace.data.accounts = workspace.data.accounts.map(account =>
    account.id === slave.id ? { ...account, proxy: { spec: 'socks5://127.0.0.1:1080' } } : account
  );
  const selected = handlers.get('account:preferences-save')({ id: slave.id, values: {}, routePresetId: preset.id });
  assert.equal(selected.saved, true);
  const chosen = workspace.data.accounts.find(account => account.id === slave.id);
  assert.ok(chosen);
  assert.equal(chosen.routePresetId, preset.id);
  assert.equal(Object.hasOwn(chosen, 'proxy'), false);
  handlers.get('account:preferences-save')({ id: slave.id, values: {}, routePresetId: '' });
  const cleared = workspace.data.accounts.find(account => account.id === slave.id);
  assert.ok(cleared);
  assert.equal(Object.hasOwn(cleared, 'routePresetId'), false);
});
