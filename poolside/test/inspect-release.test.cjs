const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describeRelease, renderInspection, missingArchiveFiles, unsafeArchiveFiles } = require('../scripts/inspect-release.cjs');

function withRelease(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-release-'));
  try {
    fs.mkdirSync(path.join(directory, 'resources'));
    fs.writeFileSync(path.join(directory, 'Poolside.exe'), 'executable fixture');
    fs.writeFileSync(path.join(directory, 'resources', 'app.asar'), 'archive fixture');
    return run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('release inspection hashes the executable and packaged app archive', () => {
  withRelease(directory => {
    const inspection = describeRelease(directory);
    assert.equal(inspection.format, 'poolside-release-inspection/v1');
    assert.deepEqual(
      inspection.files.map(file => file.path),
      ['Poolside.exe', 'resources/app.asar']
    );
    assert.match(inspection.files[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal(renderInspection(directory), renderInspection(directory));
  });
});

test('release inspection refuses a folder missing required packaged files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-release-missing-'));
  try {
    assert.throws(() => describeRelease(directory), /missing Poolside\.exe, resources\/app\.asar/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('archive-content gate detects omitted product-truth and release-evidence documents', () => {
  const present = ['\\docs\\SBOM.cdx.json', '\\docs\\threat-model.md', '\\docs\\CAPABILITIES.md', '\\docs\\capabilities.json'];
  assert.deepEqual(missingArchiveFiles(present), ['/docs/release-evidence/README.md']);
  assert.deepEqual(missingArchiveFiles([...present, '\\docs\\release-evidence\\README.md']), []);
});

test('archive-content gate refuses unrelated root files and local user data', () => {
  assert.deepEqual(unsafeArchiveFiles(['\\src', '\\docs', '\\package.json']), []);
  assert.deepEqual(unsafeArchiveFiles(['\\test-output.log', '\\docs\\recognition-lab\\capture.png']), [
    '/test-output.log',
    '/docs/recognition-lab/capture.png'
  ]);
});
