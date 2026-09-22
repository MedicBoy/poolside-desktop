// The filesystem itself refusing, rather than a fault this code injects.
//
// `fault-tolerance.test.cjs` fails a write at a chosen checkpoint inside the writer. These tests fail it from
// outside, with the operating system saying no — an attribute that makes the file unreplaceable, and a path
// occupied by something that is not a file. The difference matters: the checkpoint hook proves the sequence, and
// this proves the cleanup, the caller's behaviour and the bytes on disk when a real `EPERM` arrives.
//
// Windows only, and the tests say so rather than skipping silently: on a POSIX filesystem a read-only file is
// still replaceable inside a directory you own, so the same call would succeed and the test would be asserting
// nothing about this build.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const model = require('../src/model.cjs');
const { writeWorkspace, stagedFiles, recoveryAvailable } = require('../src/workspace-file.cjs');

const NEWFIE = model.account({ name: 'Newfie', role: 'receiver' });
const GMAIL = model.account({ name: 'Gmail', role: 'sender' }, [NEWFIE]);
const document = accounts => model.decode({ version: 1, accounts, settings: { table: 'Bangkok', limit: 10 }, routePresets: [] });

function withRoot(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-write-fault-'));
  try {
    return run(root);
  } finally {
    // Restore permissions before removing: a read-only file left behind would make the cleanup fail and report the
    // wrong problem.
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isFile()) {
        try {
          fs.chmodSync(path.join(root, entry.name), 0o666);
        } catch {
          /* it is about to be deleted anyway */
        }
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const windowsOnly = t => {
  if (process.platform !== 'win32') {
    t.skip('a read-only file is replaceable on this filesystem, so there is no fault to inject');
    return false;
  }
  return true;
};

test('a workspace file the system will not replace is refused, and the document that was there is untouched', t =>
  withRoot(root => {
    if (!windowsOnly(t)) return;
    const file = path.join(root, 'workspace.json');
    writeWorkspace(file, document([NEWFIE]));
    const good = fs.readFileSync(file, 'utf8');
    const previous = `${file}.previous`;
    assert.equal(fs.existsSync(previous), false, 'the first write has nothing to keep a copy of yet');

    fs.chmodSync(file, 0o444);
    assert.throws(
      () => writeWorkspace(file, document([NEWFIE, GMAIL])),
      error => /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM',
      'the system refuses the replacement, and the refusal is not swallowed'
    );
    // The three things that must be true after a refusal: the account list on disk is the one that was there, no
    // half-written sibling is left where it could be mistaken for recovery material, and nothing was promoted to
    // the recovery copy either.
    assert.equal(fs.readFileSync(file, 'utf8'), good, 'the primary document is byte-for-byte what it was');
    assert.deepEqual(stagedFiles(file), [], 'the staged file was cleaned up rather than abandoned');
    assert.equal(fs.existsSync(`${file}.tmp`), false);
    // The copy is written *before* the commit, so a refused commit leaves a valid previous-known-good document
    // behind. That is the point of the order: the write that failed is the write whose predecessor is now
    // recoverable, and the operator has something to restore from rather than a file they cannot replace.
    assert.equal(recoveryAvailable(file), true);
    assert.equal(fs.readFileSync(previous, 'utf8'), good, 'and the recovery copy holds the document that was there');

    // Clearing the attribute is the operator fixing the problem; the next write is ordinary and lands.
    fs.chmodSync(file, 0o666);
    writeWorkspace(file, document([NEWFIE, GMAIL]));
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).accounts.length, 2);
  }));

test('a path occupied by a directory is refused, and the directory is not emptied to make room', t =>
  withRoot(root => {
    if (!windowsOnly(t)) return;
    const file = path.join(root, 'workspace.json');
    fs.mkdirSync(file);
    fs.writeFileSync(path.join(file, 'something-the-operator-put-here.txt'), 'not ours');
    // Reading the primary is the first thing the writer does — it has to, to decide whether the previous copy may
    // be kept — so a path that is not a file is refused there, before a single byte is written. The code is
    // EISDIR (or EPERM, depending on where the refusal lands); what matters is that it is a refusal and not a
    // partial write.
    assert.throws(
      () => writeWorkspace(file, document([NEWFIE])),
      error => ['EISDIR', 'EPERM'].includes(String(/** @type {NodeJS.ErrnoException} */ (error).code)),
      'the path being occupied is refused rather than worked around'
    );
    // The refusal is total: a directory is never removed, never renamed aside, and never partially written into.
    assert.equal(fs.statSync(file).isDirectory(), true);
    assert.deepEqual(fs.readdirSync(file), ['something-the-operator-put-here.txt']);
    assert.deepEqual(stagedFiles(file), [], 'and nothing was staged beside it');
    assert.equal(fs.existsSync(`${file}.previous`), false, 'nor was a recovery copy written');
  }));

test("the application's own save reports a refused write and keeps the document it was using", t =>
  withRoot(root => {
    if (!windowsOnly(t)) return;
    const { workspace } = require('../src/state.cjs');
    const store = require('../src/workspace.cjs');
    const file = path.join(root, 'workspace.json');
    writeWorkspace(file, document([NEWFIE]));
    const previous = {
      data: workspace.data,
      storeFile: workspace.storeFile,
      readOnly: workspace.readOnly,
      authoritative: workspace.authoritative
    };
    workspace.storeFile = file;
    workspace.readOnly = false;
    workspace.authoritative = true;
    workspace.data = document([NEWFIE]);
    try {
      fs.chmodSync(file, 0o444);
      assert.throws(
        () => store.save(document([NEWFIE, GMAIL])),
        /EPERM|operation not permitted/i,
        'the caller is told, rather than the document being replaced in memory only'
      );
      assert.equal(workspace.data.accounts.length, 1, 'the in-memory document is what was last written successfully');
      // Window geometry is remembered on close and is allowed to fail without failing the close itself: the
      // session that is closing must not be held open by a disk that says no.
      const remembered = store.rememberWindowGeometry(NEWFIE.id, { x: 1, y: 2, width: 900, height: 700, maximized: false });
      assert.equal(remembered, false);
      assert.ok(
        require('../src/state.cjs').events.some(
          entry => entry.kind === 'warning' && /Window position could not be saved/.test(entry.message)
        ),
        "and the failure is in the activity feed, in the operator's words"
      );
      fs.chmodSync(file, 0o666);
      store.save(document([NEWFIE, GMAIL]));
      assert.equal(workspace.data.accounts.length, 2, 'once the attribute is cleared the same call succeeds');
    } finally {
      workspace.data = previous.data;
      workspace.storeFile = previous.storeFile;
      workspace.readOnly = previous.readOnly;
      workspace.authoritative = previous.authoritative;
    }
  }));
