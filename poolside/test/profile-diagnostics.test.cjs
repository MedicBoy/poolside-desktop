const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { measureDirectory, report, formatBytes, describeReport, sweepTemporaryFiles } = require('../src/profile-diagnostics.cjs');
const { carryOverFile, profileDirectory } = require('../src/profile-paths.cjs');

const ID = 'e5b1c1b3-0000-4000-8000-000000000000';

function withRoot(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-diagnostics-'));
  try {
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Write a file of exactly `size` bytes, creating parent directories. */
function writeSized(file, size) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x'.repeat(size));
}

test('a profile directory that does not exist yet is missing, not an error', () => {
  withRoot(root => {
    const measured = measureDirectory(path.join(root, 'Partitions', `poolside-${ID}`));
    assert.equal(measured.missing, true);
    assert.equal(measured.bytes, 0);
    assert.equal(measured.truncated, false);
  });
});

test('sizes and counts include nested files, and symlink entries are never followed', () => {
  withRoot(root => {
    const directory = profileDirectory(root, ID);
    writeSized(path.join(directory, 'a.txt'), 100);
    writeSized(path.join(directory, 'nested', 'b.txt'), 250);
    writeSized(path.join(directory, 'nested', 'deeper', 'c.txt'), 400);
    const measured = measureDirectory(directory);
    assert.equal(measured.bytes, 750);
    assert.equal(measured.files, 3);
    assert.equal(measured.directories, 2);
    assert.equal(measured.missing, false);
    assert.equal(measured.truncated, false);
  });
});

test('the walk is bounded and admits it when it stops early', () => {
  withRoot(root => {
    const directory = profileDirectory(root, ID);
    for (let index = 0; index < 6; index += 1) writeSized(path.join(directory, `f${index}.txt`), 10);
    const measured = measureDirectory(directory, { maxFiles: 2 });
    assert.equal(measured.truncated, true, 'the cap is reported rather than silently dropping files');
    assert.equal(measured.files, 2);
    assert.ok(measured.bytes <= 20);
  });
});

test('the report adds the carry-over file to the partition total, and keeps them separate', () => {
  withRoot(root => {
    const directory = profileDirectory(root, ID);
    const file = carryOverFile(root, ID);
    writeSized(path.join(directory, 'cache.bin'), 1000);
    writeSized(file, 300);
    const snapshot = report(root, ID);
    assert.equal(snapshot.directoryBytes, 1000);
    assert.equal(snapshot.carryOverBytes, 300);
    assert.equal(snapshot.totalBytes, 1300);
    assert.equal(snapshot.quotaBytes, null, 'no ceiling configured means no comparison, not a failure');
    assert.equal(snapshot.overQuota, false);
    assert.equal(snapshot.path, directory);
  });
});

test('the ceiling is a comparison and only ever reports', () => {
  withRoot(root => {
    writeSized(path.join(profileDirectory(root, ID), 'cache.bin'), 2048);
    assert.equal(report(root, ID, { quotaBytes: 1024 }).overQuota, true);
    assert.equal(report(root, ID, { quotaBytes: 4096 }).overQuota, false);
    assert.equal(report(root, ID, { quotaBytes: 0 }).quotaBytes, null, 'a zero ceiling is not a ceiling');
    assert.equal(report(root, ID, { quotaBytes: null }).quotaBytes, null);
    assert.equal(report(root, ID, { quotaBytes: 1024 }).quotaBytes, 1024);
  });
});

test('byte sizes are rendered the way a person reads them', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatBytes(null), 'unknown');
});

test('the one-line description never presents the ceiling as enforcement', () => {
  withRoot(root => {
    writeSized(path.join(profileDirectory(root, ID), 'cache.bin'), 2048);
    assert.match(describeReport(report(root, ID, { quotaBytes: 1024 })), /over the configured/);
    assert.match(describeReport(report(root, ID, { quotaBytes: 8192 })), /within the configured ceiling/);
    assert.match(describeReport(report(root, ID)), /2\.0 KB in 1 files/);
    assert.match(describeReport(report(root, 'f0e1d2c3-1111-4222-8333-444444444444')), /no profile directory yet/);
    const capped = measureDirectory(profileDirectory(root, ID), { maxFiles: 1 });
    assert.equal(capped.truncated, false);
  });
});

test('a capped walk says "at least", because the number is a lower bound', () => {
  withRoot(root => {
    const directory = profileDirectory(root, ID);
    for (let index = 0; index < 4; index += 1) writeSized(path.join(directory, `f${index}.txt`), 10);
    assert.match(describeReport(report(root, ID, { maxFiles: 1 })), /^at least /);
  });
});

test('the temporary-file sweep removes abandoned writes and nothing else', () => {
  withRoot(root => {
    writeSized(path.join(root, 'workspace.json'), 10);
    writeSized(path.join(root, 'workspace.json.tmp'), 10);
    writeSized(carryOverFile(root, ID), 10);
    writeSized(`${carryOverFile(root, ID)}.tmp`, 10);
    const outcome = sweepTemporaryFiles(root);
    assert.equal(fs.existsSync(path.join(root, 'workspace.json.tmp')), false);
    assert.equal(fs.existsSync(`${carryOverFile(root, ID)}.tmp`), false);
    assert.equal(fs.existsSync(path.join(root, 'workspace.json')), true, 'the live document is untouched');
    assert.equal(fs.existsSync(carryOverFile(root, ID)), true, 'the live carry-over file is untouched');
    assert.deepEqual(outcome.removed.sort(), [path.join('accounts', `${ID}.plist.tmp`), 'workspace.json.tmp'].sort());
    assert.deepEqual(outcome.failed, []);
  });
});

test('the sweep tolerates a data directory that has no accounts folder yet', () => {
  withRoot(root => {
    const outcome = sweepTemporaryFiles(root);
    assert.deepEqual(outcome.removed, []);
    assert.deepEqual(outcome.failed, []);
  });
});
