const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const model = require('../src/model.cjs');
const store = require('../src/workspace.cjs');
const { workspace } = require('../src/state.cjs');

function withWorkspace(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-workspace-load-'));
  const previous = {
    data: workspace.data,
    storeFile: workspace.storeFile,
    readOnly: workspace.readOnly,
    authoritative: workspace.authoritative
  };
  try {
    run(root);
  } finally {
    Object.assign(workspace, previous);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('a missing workspace is explicitly non-authoritative', () => {
  withWorkspace(root => {
    workspace.authoritative = true;
    const result = store.load(path.join(root, 'workspace.json'));
    assert.deepEqual(result, { state: 'missing' });
    assert.equal(workspace.authoritative, false);
    assert.equal(workspace.readOnly, false);
  });
});

test('a missing primary with a previous copy is read-only instead of starting an empty workspace', () => {
  withWorkspace(root => {
    const file = path.join(root, 'workspace.json');
    const original = {
      version: 1,
      accounts: [model.account({ name: 'Main', role: 'receiver' })],
      settings: { table: 'Bangkok', limit: 10 }
    };
    fs.writeFileSync(`${file}.previous`, JSON.stringify(original));
    assert.deepEqual(store.load(file), { state: 'recovery-available' });
    assert.equal(workspace.readOnly, true);
    assert.equal(workspace.authoritative, false);
    assert.throws(() => store.save({ ...original, accounts: [] }), /could not be read/);
    assert.equal(fs.existsSync(file), false);
  });
});

test('an interrupted legacy temporary workspace also blocks an empty replacement', () => {
  withWorkspace(root => {
    const file = path.join(root, 'workspace.json');
    fs.writeFileSync(`${file}.tmp`, '{"version":1}');
    assert.deepEqual(store.load(file), { state: 'recovery-available' });
    assert.equal(workspace.readOnly, true);
    assert.equal(fs.existsSync(file), false);
  });
});

test('one invalid account makes the entire workspace non-authoritative and read-only', () => {
  withWorkspace(root => {
    const file = path.join(root, 'workspace.json');
    const valid = model.account({ name: 'Main', role: 'receiver' });
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        accounts: [valid, { ...valid, id: 'not-a-uuid', name: 'Broken', role: 'sender' }],
        settings: { table: 'Bangkok', limit: 10 }
      })
    );

    const result = store.load(file);
    assert.deepEqual(result, { state: 'invalid' });
    assert.equal(workspace.authoritative, false);
    assert.equal(workspace.readOnly, true);
  });
});

test('a fully decoded workspace is authoritative', () => {
  withWorkspace(root => {
    const file = path.join(root, 'workspace.json');
    const account = model.account({ name: 'Main', role: 'receiver' });
    fs.writeFileSync(file, JSON.stringify({ version: 1, accounts: [account], settings: { table: 'Bangkok', limit: 10 } }));
    const result = store.load(file);
    assert.deepEqual(result, { state: 'loaded' });
    assert.equal(workspace.authoritative, true);
    assert.equal(workspace.readOnly, false);
    assert.equal(workspace.data.accounts[0].id, account.id);
  });
});
