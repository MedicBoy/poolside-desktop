// Reading the workspace's own recovery material: what each copy holds, and what may be handed back for a
// restore. The dashboard must never be given a proxy password by way of a preview.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorkspaceRecovery } = require('../src/workspace-recovery.cjs');
const { registerRecoveryIpc } = require('../src/recovery-ipc.cjs');
const { writeWorkspace } = require('../src/workspace-file.cjs');
const model = require('../src/model.cjs');
const store = require('../src/workspace.cjs');
const { workspace } = require('../src/state.cjs');

/** The directory has to outlive an async callback, so this awaits it before cleaning up. */
async function withRoot(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-recovery-'));
  try {
    return await run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const document = accounts =>
  model.decode({
    version: 1,
    accounts,
    settings: { table: 'Bangkok', limit: 10 },
    routePresets: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'London-1',
        enabled: true,
        spec: 'http://user:secret@198.105.121.200:6462',
        bypass: ''
      }
    ]
  });

test('a recovery copy is described with what it holds, and never with a password', () =>
  withRoot(root => {
    const file = path.join(root, 'workspace.json');
    const first = model.account({ name: 'Newfie', role: 'receiver' });
    writeWorkspace(file, document([first]));
    // A second write keeps the first document as the previous copy.
    writeWorkspace(file, document([first, model.account({ name: 'Gmail', role: 'sender' }, [first])]));

    const recovery = createWorkspaceRecovery({ file });
    const candidates = recovery.candidates();
    assert.equal(candidates.length, 1);
    const [previous] = candidates;
    assert.equal(previous.source, 'previous');
    assert.equal(previous.name, 'workspace.json.previous');
    assert.equal(previous.usable, true);
    assert.equal(previous.problem, null);
    assert.deepEqual(
      previous.accounts.map(account => account.name),
      ['Newfie']
    );
    assert.deepEqual(previous.locations, ['London-1']);
    assert.ok(Number.isFinite(Date.parse(previous.writtenAt)));
    assert.equal(JSON.stringify(previous).includes('secret'), false, 'a preview carries no credentials');
  }));

test('a copy that cannot be read is listed with the reason rather than hidden', () =>
  withRoot(root => {
    const file = path.join(root, 'workspace.json');
    writeWorkspace(file, document([model.account({ name: 'Newfie', role: 'receiver' })]));
    fs.writeFileSync(`${file}.previous`, '{ this is not a workspace');
    const candidates = createWorkspaceRecovery({ file }).candidates();
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].usable, false);
    assert.match(candidates[0].problem, /could not be read as a workspace document/);
    assert.deepEqual(candidates[0].accounts, []);
  }));

test('a staged write left behind by an interrupted save is offered too, newest first', () =>
  withRoot(root => {
    const file = path.join(root, 'workspace.json');
    const account = model.account({ name: 'Newfie', role: 'receiver' });
    writeWorkspace(file, document([account]));
    fs.writeFileSync(
      `${file}.tmp-abcd1234`,
      JSON.stringify(document([account, model.account({ name: 'Gmail', role: 'sender' }, [account])]))
    );
    const candidates = createWorkspaceRecovery({ file }).candidates();
    assert.equal(candidates.length, 1, 'only the staged file exists besides the primary');
    assert.equal(candidates[0].source, 'staged');
    assert.equal(candidates[0].accounts.length, 2);
  }));

test('reading a candidate hands back a document the application could save', () =>
  withRoot(root => {
    const file = path.join(root, 'workspace.json');
    const account = model.account({ name: 'Newfie', role: 'receiver' });
    writeWorkspace(file, document([account]));
    writeWorkspace(file, document([account, model.account({ name: 'Gmail', role: 'sender' }, [account])]));
    const recovery = createWorkspaceRecovery({ file });
    const restored = recovery.read('workspace.json.previous');
    assert.equal(restored.accounts.length, 1);
    // The document is complete, credentials included: it is going to the application's own save, not the page.
    assert.equal(restored.routePresets[0].spec.includes('secret'), true);
    assert.deepEqual(model.decode(restored), restored);
    assert.throws(() => recovery.read('nothing.json'), /no longer there/);
  }));

test('a copy that cannot be read is refused by name rather than restored', () =>
  withRoot(root => {
    const file = path.join(root, 'workspace.json');
    writeWorkspace(file, document([model.account({ name: 'Newfie', role: 'receiver' })]));
    fs.writeFileSync(`${file}.previous`, 'not json');
    assert.throws(() => createWorkspaceRecovery({ file }).read('workspace.json.previous'), /could not be read as a workspace document/);
  }));

test('the dashboard surface previews, confirms, restores and says what it did', async () => {
  await withRoot(async root => {
    const file = path.join(root, 'workspace.json');
    const account = model.account({ name: 'Newfie', role: 'receiver' });
    writeWorkspace(file, document([account]));
    writeWorkspace(file, document([account, model.account({ name: 'Gmail', role: 'sender' }, [account])]));
    const recovery = createWorkspaceRecovery({ file });
    const handlers = new Map();
    const restoredDocuments = [];
    const logged = [];
    /** @type {any} */
    let asked = null;
    registerRecoveryIpc({
      handle: (name, fn) => handlers.set(name, fn),
      recovery,
      restore: value => {
        restoredDocuments.push(value);
        return { preservedName: null };
      },
      isReadOnly: () => false,
      hasOpenSessions: () => false,
      log: message => logged.push(message),
      confirmDestructive: async (title, detail) => {
        asked = { title, detail };
        return true;
      }
    });
    const preview = handlers.get('recovery:preview')();
    assert.equal(preview.candidates.length, 1);
    const restored = await handlers.get('recovery:restore')({ name: 'workspace.json.previous' });
    assert.equal(restored.accounts.length, 1);
    assert.match(asked.title, /Replace the workspace with this recovery copy\?/);
    assert.match(asked.detail, /kept as the previous copy when/);
    assert.equal(restoredDocuments.length, 1, "the restore goes through the application's own restore");
    assert.equal(restoredDocuments[0].accounts.length, 1);
    assert.match(logged.at(-1), /Workspace restored from workspace\.json\.previous \(1 account slot\(s\)\)\./);
    await assert.rejects(() => handlers.get('recovery:restore')({ name: 'gone.json' }), /no longer there/);
  });
});

test('a declined confirmation restores nothing', async () => {
  await withRoot(async root => {
    const file = path.join(root, 'workspace.json');
    const account = model.account({ name: 'Newfie', role: 'receiver' });
    writeWorkspace(file, document([account]));
    writeWorkspace(file, document([account, model.account({ name: 'Gmail', role: 'sender' }, [account])]));
    const handlers = new Map();
    const restoredDocuments = [];
    registerRecoveryIpc({
      handle: (name, fn) => handlers.set(name, fn),
      recovery: createWorkspaceRecovery({ file }),
      restore: value => {
        restoredDocuments.push(value);
        return { preservedName: null };
      },
      isReadOnly: () => false,
      hasOpenSessions: () => false,
      log: () => {},
      confirmDestructive: async () => false
    });
    await assert.rejects(() => handlers.get('recovery:restore')({ name: 'workspace.json.previous' }), /cancelled/);
    assert.deepEqual(restoredDocuments, []);
  });
});

test('a damaged primary can be restored through the real read-only workspace path', async () => {
  await withRoot(async root => {
    const file = path.join(root, 'workspace.json');
    const account = model.account({ name: 'Saved', role: 'receiver' });
    writeWorkspace(file, document([account]));
    writeWorkspace(file, document([account, model.account({ name: 'Later', role: 'sender' }, [account])]));
    fs.writeFileSync(file, '{broken workspace');
    const old = {
      data: workspace.data,
      storeFile: workspace.storeFile,
      readOnly: workspace.readOnly,
      authoritative: workspace.authoritative
    };
    try {
      assert.equal(store.load(file).state, 'invalid');
      assert.equal(workspace.readOnly, true);
      const handlers = new Map();
      registerRecoveryIpc({
        handle: (name, fn) => handlers.set(name, fn),
        recovery: createWorkspaceRecovery({ file }),
        restore: store.restore,
        isReadOnly: () => workspace.readOnly,
        hasOpenSessions: () => false,
        log: () => {},
        confirmDestructive: async () => true
      });
      const result = await handlers.get('recovery:restore')({ name: 'workspace.json.previous' });
      assert.equal(workspace.readOnly, false);
      assert.equal(workspace.authoritative, true);
      assert.deepEqual(
        workspace.data.accounts.map(a => a.name),
        ['Saved']
      );
      assert.equal(fs.readFileSync(path.join(root, result.preservedName), 'utf8'), '{broken workspace');
      assert.deepEqual(
        JSON.parse(fs.readFileSync(file, 'utf8')).accounts.map(a => a.name),
        ['Saved']
      );
    } finally {
      Object.assign(workspace, old);
    }
  });
});

test('a missing primary with a valid previous copy leaves read-only mode after restore', async () => {
  await withRoot(async root => {
    const file = path.join(root, 'workspace.json');
    const account = model.account({ name: 'Saved', role: 'receiver' });
    writeWorkspace(file, document([account]));
    writeWorkspace(file, { ...document([account]), settings: { table: 'Dubai', limit: 10 } });
    fs.unlinkSync(file);
    const old = {
      data: workspace.data,
      storeFile: workspace.storeFile,
      readOnly: workspace.readOnly,
      authoritative: workspace.authoritative
    };
    try {
      assert.equal(store.load(file).state, 'recovery-available');
      const selected = createWorkspaceRecovery({ file }).read('workspace.json.previous');
      const result = store.restore(selected);
      assert.equal(result.preservedName, null);
      assert.equal(workspace.readOnly, false);
      assert.equal(workspace.authoritative, true);
      assert.deepEqual(
        JSON.parse(fs.readFileSync(file, 'utf8')).accounts.map(a => a.name),
        ['Saved']
      );
    } finally {
      Object.assign(workspace, old);
    }
  });
});

test('recovery is refused while an account window is open', async () => {
  await withRoot(async root => {
    const file = path.join(root, 'workspace.json');
    const saved = model.account({ name: 'Saved', role: 'receiver' });
    writeWorkspace(file, document([saved]));
    writeWorkspace(file, { ...document([saved]), settings: { table: 'Dubai', limit: 10 } });
    const handlers = new Map();
    registerRecoveryIpc({
      handle: (name, fn) => handlers.set(name, fn),
      recovery: createWorkspaceRecovery({ file }),
      restore: () => {
        throw new Error('must not restore');
      },
      isReadOnly: () => false,
      hasOpenSessions: () => true,
      log: () => {},
      confirmDestructive: async () => true
    });
    await assert.rejects(() => handlers.get('recovery:restore')({ name: 'workspace.json.previous' }), /Close every account window/);
  });
});

test('a recovery copy changed during confirmation must be previewed again', async () => {
  await withRoot(async root => {
    const file = path.join(root, 'workspace.json');
    const account = model.account({ name: 'Saved', role: 'receiver' });
    writeWorkspace(file, document([account]));
    writeWorkspace(file, { ...document([account]), settings: { table: 'Dubai', limit: 10 } });
    const handlers = new Map();
    registerRecoveryIpc({
      handle: (name, fn) => handlers.set(name, fn),
      recovery: createWorkspaceRecovery({ file }),
      restore: () => {
        throw new Error('must not restore');
      },
      isReadOnly: () => false,
      hasOpenSessions: () => false,
      log: () => {},
      confirmDestructive: async () => {
        fs.writeFileSync(`${file}.previous`, JSON.stringify(document([])));
        return true;
      }
    });
    await assert.rejects(() => handlers.get('recovery:restore')({ name: 'workspace.json.previous' }), /changed after the preview/);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(file, 'utf8')).accounts.map(a => a.name),
      ['Saved']
    );
  });
});
