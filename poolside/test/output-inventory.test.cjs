// The folder Poolside writes into, and the erasure control that touches it.
//
// The dangerous half of "erase these files" is the name, because a name is input. Every test below is about a
// refusal: something that is not ours, something that is a directory, something that climbs out of the folder.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const inventory = require('../src/output-inventory.cjs');

const DIAGNOSTICS = 'poolside-diagnostics-2026-09-22_01-00-00-100.json';
const REPORT = 'poolside-run-report-2026-09-22_01-05-00-200.json';
const STAGED = 'poolside-run-report-2026-09-22_01-05-00-200.json.tmp-4321';

/** A data root with an export folder in it, and the files the test puts there. */
function fixture(files = [], extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-outputs-'));
  const folder = path.join(root, 'diagnostics');
  fs.mkdirSync(folder, { recursive: true });
  for (const [name, contents] of files) fs.writeFileSync(path.join(folder, name), contents);
  return { root, folder, ...extra };
}

test('the list holds only the documents this application writes, newest first', () => {
  const { root } = fixture([
    [DIAGNOSTICS, 'a'.repeat(10)],
    [REPORT, 'b'.repeat(30)],
    ['holiday-photo.jpg', 'not ours']
  ]);
  // Written times are set rather than left to the filesystem: two files written in the same millisecond used to
  // make an ordering assertion fail for a reason that had nothing to do with the ordering rule.
  fs.utimesSync(path.join(root, 'diagnostics', DIAGNOSTICS), new Date('2026-09-22T01:00:00Z'), new Date('2026-09-22T01:00:00Z'));
  fs.utimesSync(path.join(root, 'diagnostics', REPORT), new Date('2026-09-22T01:05:00Z'), new Date('2026-09-22T01:05:00Z'));
  const view = inventory.list({ root });
  assert.equal(view.exists, true);
  assert.deepEqual(
    view.entries.map(entry => entry.name),
    [REPORT, DIAGNOSTICS],
    'both are listed, newest first'
  );
  assert.equal(view.bytes, 40);
  assert.equal(view.ignored, 1, 'the file the operator put there is counted as left alone');
  assert.ok(view.entries.every(entry => entry.label && entry.writtenAt && Number.isFinite(entry.bytes)));
  assert.deepEqual(
    view.entries.map(entry => entry.kind).sort(),
    ['diagnostics', 'run-report'],
    'each entry says which kind of document it is'
  );
  // The path is the one thing the dashboard must never be handed.
  assert.equal(JSON.stringify(view).includes(root.replaceAll('\\', '\\\\')), false);
});

test('an interrupted write is recognised for what it is rather than read as a document', () => {
  const { root } = fixture([[STAGED, 'half a report']]);
  const view = inventory.list({ root });
  assert.deepEqual(
    view.entries.map(entry => entry.kind),
    ['staged']
  );
  assert.match(view.entries[0].label, /interrupted write/);
  assert.equal(inventory.classify(REPORT)?.kind, 'run-report');
  assert.equal(inventory.classify(DIAGNOSTICS)?.kind, 'diagnostics');
  assert.equal(inventory.classify('notes.txt'), null);
  assert.equal(inventory.classify('../workspace.json'), null, 'a path is not a name this application writes');
});

test('the folder missing is an empty answer rather than a failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-outputs-empty-'));
  const view = inventory.list({ root });
  assert.deepEqual(view, { exists: false, entries: [], ignored: 0, bytes: 0, oldest: null, newest: null });
  assert.deepEqual(inventory.clear({ root, names: [REPORT] }), {
    removed: [],
    skipped: [{ name: REPORT, reason: 'already gone' }],
    bytes: 0
  });
  assert.deepEqual(inventory.list({}), { exists: false, entries: [], ignored: 0, bytes: 0, oldest: null, newest: null });
});

test('erasing removes the named files and nothing else', () => {
  const { root, folder } = fixture([
    [DIAGNOSTICS, 'a'.repeat(10)],
    [REPORT, 'b'.repeat(30)],
    ['keep-me.txt', 'not ours']
  ]);
  const result = inventory.clear({ root, names: [DIAGNOSTICS] });
  assert.deepEqual(result.removed, [DIAGNOSTICS]);
  assert.equal(result.bytes, 10);
  assert.deepEqual(result.skipped, []);
  assert.equal(fs.existsSync(path.join(folder, DIAGNOSTICS)), false, 'the named file is gone');
  assert.equal(fs.existsSync(path.join(folder, REPORT)), true, 'a file that was not named is untouched');
  assert.equal(fs.existsSync(path.join(folder, 'keep-me.txt')), true, 'a file that is not ours is untouched');
  assert.deepEqual(
    inventory.list({ root }).entries.map(entry => entry.name),
    [REPORT]
  );
});

test('a name that would climb out of the folder is refused, not resolved', () => {
  const { root, folder } = fixture([[DIAGNOSTICS, 'a']]);
  const outside = path.join(root, 'workspace.json');
  fs.writeFileSync(outside, '{"accounts":[]}');
  // A name that climbs out is refused by two locks, and the test names them both. The first is the name grammar —
  // a name this application writes cannot contain a separator at all — and the second is the containment check
  // `clear` runs before it touches anything. The second is unreachable while the first holds; it is kept because
  // the cost of being wrong about it is deleting a file outside the folder.
  const attempted = ['../workspace.json', path.join(folder, DIAGNOSTICS), 'sub/poolside-run-report-x.json', '..\\workspace.json'];
  for (const name of attempted) assert.equal(inventory.classify(name), null, `${name} must not be read as a name this application writes`);
  const result = inventory.clear({ root, names: attempted });
  assert.deepEqual(result.removed, []);
  assert.equal(result.skipped.length, attempted.length);
  assert.ok(
    result.skipped.every(entry => entry.reason === 'not a file this application writes'),
    'the grammar refused them before the containment check was needed'
  );
  assert.equal(fs.existsSync(outside), true, 'the workspace file is still there');
  assert.equal(fs.existsSync(path.join(folder, DIAGNOSTICS)), true, 'and so is the file it belongs beside');
});

test('a directory is never deleted in place of a file, whatever it is called', () => {
  const { root, folder } = fixture([]);
  fs.mkdirSync(path.join(folder, REPORT));
  fs.writeFileSync(path.join(folder, REPORT, 'something.json'), 'not a document');
  const result = inventory.clear({ root, names: [REPORT] });
  assert.deepEqual(result.removed, []);
  assert.equal(result.skipped[0].reason, 'not a file');
  assert.equal(fs.existsSync(path.join(folder, REPORT, 'something.json')), true);
  assert.equal(inventory.list({ root }).ignored, 1, 'and the list says it left something alone');
});

test('junk input is refused rather than throwing', () => {
  const { root } = fixture([[DIAGNOSTICS, 'a']]);
  for (const names of [undefined, null, 'a string', [1, null, {}], []]) {
    assert.doesNotThrow(() => inventory.clear({ root, names }));
  }
  assert.deepEqual(inventory.clear({ root, names: [null] }).skipped, [{ name: 'null', reason: 'not a file this application writes' }]);
  assert.equal(fs.existsSync(path.join(root, 'diagnostics', DIAGNOSTICS)), true);
});
