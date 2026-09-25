const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { account } = require('../src/model.cjs');
const { writeWorkspace, restoreUnreadableWorkspace, recoveryAvailable, stagedFiles } = require('../src/workspace-file.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-workspace-file-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'workspace.json');
  const first = { version: 1, accounts: [account({ name: 'Main', role: 'receiver' })], settings: { table: 'Bangkok', limit: 10 } };
  const second = { ...first, settings: { table: 'Dubai', limit: 12 } };
  return { file, first, second };
}

test('validated workspace replacement flushes a new primary and retains one previous-known-good copy', t => {
  const { file, first, second } = fixture(t);
  assert.deepEqual(writeWorkspace(file, first), first);
  assert.equal(recoveryAvailable(file), false);
  assert.deepEqual(writeWorkspace(file, second), second);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), second);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.previous`, 'utf8')), first);
  assert.deepEqual(stagedFiles(file), []);
});

for (const stage of ['new-flushed', 'previous-replaced', 'before-commit'])
  test(`injected ${stage} failure preserves the prior workspace and cleans staging files`, t => {
    const { file, first, second } = fixture(t);
    writeWorkspace(file, first);
    assert.throws(
      () =>
        writeWorkspace(file, second, {
          checkpoint: point => {
            if (point === stage) throw new Error('injected write failure');
          }
        }),
      /injected write failure/
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), first);
    assert.deepEqual(stagedFiles(file), []);
    if (stage !== 'new-flushed') assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.previous`, 'utf8')), first);
  });

test('invalid new data and a damaged existing primary cannot be promoted or overwrite known-good data', t => {
  const { file, first, second } = fixture(t);
  writeWorkspace(file, first);
  assert.throws(() => writeWorkspace(file, { ...second, version: 99 }), /Unsupported workspace data/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), first);
  fs.writeFileSync(file, '{broken');
  assert.throws(() => writeWorkspace(file, second));
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  assert.equal(fs.existsSync(`${file}.previous`), false);
  assert.deepEqual(stagedFiles(file), []);
});

test('removing an account or cleared proxy secret purges the old recovery copy', t => {
  const { file, first } = fixture(t);
  writeWorkspace(file, first);
  writeWorkspace(file, { ...first, settings: { ...first.settings, limit: 11 } });
  assert.equal(fs.existsSync(`${file}.previous`), true);
  writeWorkspace(file, { ...first, accounts: [] });
  assert.equal(fs.existsSync(`${file}.previous`), false);

  const withProxy = { ...first, settings: { ...first.settings, proxy: { enabled: true, spec: 'user:secret@host:1234' } } };
  writeWorkspace(file, withProxy);
  writeWorkspace(file, { ...withProxy, settings: { ...withProxy.settings, limit: 11 } });
  assert.equal(fs.existsSync(`${file}.previous`), true);
  writeWorkspace(file, first);
  assert.equal(fs.existsSync(`${file}.previous`), false);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /secret/);
});

test('explicit restore preserves an unreadable primary byte for byte', t => {
  const { file, first } = fixture(t);
  const damaged = Buffer.from('{broken workspace');
  fs.writeFileSync(file, damaged);
  const result = restoreUnreadableWorkspace(file, first);
  assert.deepEqual(result.document, first);
  assert.ok(result.preservedName);
  assert.match(result.preservedName, /^workspace\.json\.unreadable-/);
  assert.deepEqual(fs.readFileSync(path.join(path.dirname(file), result.preservedName)), damaged);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), first);
  assert.deepEqual(stagedFiles(file), []);
});

test('explicit restore works when the primary is missing and leaves an existing copy alone', t => {
  const { file, first, second } = fixture(t);
  fs.writeFileSync(`${file}.previous`, JSON.stringify(first));
  const result = restoreUnreadableWorkspace(file, second);
  assert.equal(result.preservedName, null);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), second);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.previous`, 'utf8')), first);
});

test('explicit restore refuses a primary made valid since the app loaded it', t => {
  const { file, first, second } = fixture(t);
  fs.writeFileSync(file, JSON.stringify(first));
  assert.throws(() => restoreUnreadableWorkspace(file, second), /changed since startup/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), first);
});
