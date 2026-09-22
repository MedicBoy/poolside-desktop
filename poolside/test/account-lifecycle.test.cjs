// The four lifecycle actions, in the order an operator actually performs them, on two accounts at once.
//
// Each action has its own tests. This file exists for what those cannot show: archive → restore → delete profile
// → remove the account, run in sequence on one account while a second account stays untouched beside it. The
// question it answers is not "does archive work" but "after four steps, whose storage is gone, whose is not, and
// did anything quietly count as a new establishment along the way".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProfileManager } = require('../src/profile-manager.cjs');
const { registerAccountManagement } = require('../src/account-management-ipc.cjs');
const model = require('../src/model.cjs');
const { writeWorkspace } = require('../src/workspace-file.cjs');
const { carryOverFile, profileDirectory } = require('../src/profile-paths.cjs');
const { workspace, sessions, profileReports } = require('../src/state.cjs');

const MAIN = 'e5b1c1b3-0000-4000-8000-000000000000';
const SECOND = 'f0e1d2c3-1111-4222-8333-444444444444';

const crypto = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value, 'utf8'),
  decryptString: value => value.toString('utf8')
};

/**
 * A data root with a real workspace document on disk and two real profile directories, driven through the
 * application's own store, project manager and account-management handlers.
 */
function withData(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-lifecycle-'));
  const previous = {
    data: workspace.data,
    storeFile: workspace.storeFile,
    readOnly: workspace.readOnly,
    authoritative: workspace.authoritative
  };
  const main = model.account({ name: 'Main', role: 'receiver' });
  const second = model.account({ name: 'Second', role: 'sender' }, [main]);
  const first = { ...main, id: MAIN };
  const other = { ...second, id: SECOND };
  // A local name for the document path: `workspace.storeFile` is typed as possibly absent, and this fixture is
  // the one that knows it is there.
  const storeFile = path.join(root, 'workspace.json');
  workspace.storeFile = storeFile;
  workspace.readOnly = false;
  workspace.authoritative = true;
  workspace.data = {
    version: 1,
    accounts: [first, other],
    settings: { table: 'Bangkok', limit: 10 },
    // Remembered window geometry per account: the reference a removal has to clear, or a later re-add of the same
    // name would put a window back where a deleted account's window used to be.
    // Geometry has to be whole and sane, or the document's own normalisation drops it before any of this matters.
    windows: {
      [MAIN]: { x: 10, y: 20, width: 900, height: 700 },
      [SECOND]: { x: 30, y: 40, width: 900, height: 700 }
    }
  };
  writeWorkspace(storeFile, workspace.data);
  sessions.clear();
  profileReports.clear();
  const save = next => {
    workspace.data = next;
    writeWorkspace(storeFile, next);
  };
  const manager = createProfileManager({ log: () => {}, root, crypto });
  const document = () => JSON.parse(fs.readFileSync(storeFile, 'utf8'));
  const accountIn = id => document().accounts.find(entry => entry.id === id);
  // Anyone's directory has to exist before the first inspection, the same way the application does it.
  manager.ensureRoots();
  for (const id of [MAIN, SECOND]) {
    // Every call reads the account back out of the document, because establishing writes bookkeeping and a stale
    // copy in memory would ask the same question twice and get the same first-time answer both times.
    manager.initialise(accountIn(id));
    fs.mkdirSync(profileDirectory(root, id), { recursive: true });
    fs.writeFileSync(path.join(profileDirectory(root, id), 'Cookies'), 'persistent-cookie-store');
    fs.mkdirSync(path.dirname(carryOverFile(root, id)), { recursive: true });
    fs.writeFileSync(carryOverFile(root, id), 'encrypted-session-cookies');
    // Chromium creates the partition directory when the window is used, so the application only *sees* one on a
    // later establish — which is when it records that this account's storage is established. Doing it in the same
    // order here is what makes the generation assertions below mean what they say.
    manager.initialise(accountIn(id));
  }
  const handlers = new Map();
  registerAccountManagement({
    handle: (name, handler) => handlers.set(name, handler),
    model,
    workspace,
    sessions,
    windows: { openAccount: async () => {}, closeAccount: () => {} },
    save,
    log: () => {},
    getAccount: id => {
      const account = workspace.data.accounts.find(candidate => candidate.id === id);
      if (!account) throw new Error('Account not found.');
      return account;
    },
    // The real deletion path, not a stand-in: the point of this file is where the storage actually goes.
    profiles: { remove: account => manager.remove(account) },
    confirmRoleChange: async () => true,
    confirmDestructive: async () => true,
    activeAccounts: () => workspace.data.accounts.filter(account => !account.archived)
  });
  const cleanup = () => {
    workspace.data = previous.data;
    workspace.storeFile = previous.storeFile;
    workspace.readOnly = previous.readOnly;
    workspace.authoritative = previous.authoritative;
    sessions.clear();
    profileReports.clear();
    fs.rmSync(root, { recursive: true, force: true });
  };
  let result;
  try {
    result = run({ root, manager, handlers, document, accountIn, first, other });
  } catch (error) {
    cleanup();
    throw error;
  }
  if (result && typeof result.then === 'function') return result.finally(cleanup);
  cleanup();
  return result;
}

test('archive and restore return the same storage, and never count as a new establishment', () => {
  withData(({ root, handlers, accountIn }) => {
    assert.equal(accountIn(MAIN).profile.generation, 1, 'the first look established the storage once');
    assert.equal(accountIn(MAIN).profile.established, true, 'and the partition directory was seen');
    // Archive hides the slot. It must not touch the profile: the whole point of archiving is that restoring it
    // brings back a signed-in browser rather than an empty one.
    handlers.get('account:archive')(SECOND);
    assert.equal(accountIn(SECOND).archived, true);
    assert.equal(accountIn(SECOND).profile.generation, 1, 'archiving is not a re-establishment');
    assert.equal(fs.existsSync(profileDirectory(root, SECOND)), true, 'an archived account keeps its profile');
    assert.equal(fs.existsSync(carryOverFile(root, SECOND)), true, 'and its encrypted session file');
    // Restore re-opens it through the same establish path.
    handlers.get('account:restore')(SECOND);
    assert.equal(accountIn(SECOND).archived, false);
    assert.equal(accountIn(SECOND).profile.generation, 1, 'the same directory, so the generation cannot have moved');
    assert.equal(accountIn(SECOND).profile.established, true);
    assert.equal(accountIn(MAIN).profile.generation, 1, 'and the account beside it is untouched by either step');
    assert.equal(fs.existsSync(path.join(profileDirectory(root, MAIN), 'Cookies')), true);
  });
});

test('deleting one account profile leaves the record, the workspace, and the other account alone', async () => {
  await withData(async ({ root, manager, accountIn }) => {
    // The same call the `account:delete-profile` handler makes once its native confirmation has been answered.
    const result = await manager.remove(accountIn(SECOND));
    assert.deepEqual(result.removed.length > 0, true, 'the removal reports what it removed');
    assert.deepEqual(result.failures, []);
    assert.equal(fs.existsSync(profileDirectory(root, SECOND)), false, 'the named profile is gone');
    assert.equal(fs.existsSync(carryOverFile(root, SECOND)), false, 'and so is its session file');
    assert.equal(fs.existsSync(profileDirectory(root, MAIN)), true, 'the other account keeps its profile');
    assert.equal(fs.existsSync(carryOverFile(root, MAIN)), true, 'and its session file');
    // The record stays, and its bookkeeping is cleared: the next open is a new establishment, not a continuation
    // of storage that no longer exists.
    assert.ok(accountIn(SECOND), 'the account slot is still in the document');
    assert.equal(accountIn(SECOND).profile, undefined);
  });
});

test('a re-open after a profile deletion counts a new generation rather than reporting the old one', async () => {
  await withData(async ({ root, manager, accountIn }) => {
    await manager.remove(accountIn(SECOND));
    const again = manager.initialise(accountIn(SECOND));
    assert.equal(again.action, 'created', 'storage that is gone is established, not inherited');
    assert.equal(again.generation, 1, 'and it starts over at the first generation');
    assert.equal(fs.existsSync(profileDirectory(root, SECOND)), false, 'the directory appears when Chromium uses it, not here');
  });
});

test('removing an account for good takes its storage and its saved window with it', async () => {
  await withData(async ({ root, handlers, document, accountIn }) => {
    handlers.get('account:archive')(SECOND);
    assert.equal(accountIn(SECOND).archived, true);
    const removed = await handlers.get('account:delete')(SECOND);
    assert.ok(Array.isArray(removed.removed) && removed.removed.length > 0, 'the removal reports what it removed');
    assert.deepEqual(removed.failures, []);
    const after = document();
    assert.equal(
      after.accounts.some(entry => entry.id === SECOND),
      false,
      'the slot is gone from the document, not merely hidden'
    );
    assert.equal(fs.existsSync(profileDirectory(root, SECOND)), false);
    assert.equal(fs.existsSync(carryOverFile(root, SECOND)), false);
    // The neighbouring account is the control: a removal that took everything would look correct on its own.
    assert.equal(
      after.accounts.some(entry => entry.id === MAIN),
      true
    );
    assert.equal(fs.existsSync(profileDirectory(root, MAIN)), true);
    assert.equal(fs.existsSync(path.join(profileDirectory(root, MAIN), 'Cookies')), true);
    // And the saved window reference goes with it, while the neighbouring account keeps its own.
    assert.equal(after.windows?.[SECOND], undefined, 'the removed account has no remembered window');
    assert.equal(after.windows?.[MAIN]?.x, 10, 'the neighbouring account keeps its remembered window');
  });
});
