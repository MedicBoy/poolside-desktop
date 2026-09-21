const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'validate-capture-corpus.cjs');

test('corpus command reports aggregate failures without echoing manifest contents or its path', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-corpus-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const manifest = path.join(directory, 'manifest.json');
  fs.writeFileSync(
    manifest,
    JSON.stringify({
      version: 1,
      samples: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          imageHash: 'a'.repeat(64),
          cohort: 'benchmark',
          expectedState: 'lobby',
          observedState: 'lobby',
          score: 0.9,
          source: 'full-frame',
          capturedAt: '2026-01-01T00:00:00.000Z',
          width: 1280,
          height: 720,
          privateAccountNote: 'must-not-be-printed'
        }
      ]
    })
  );
  const result = spawnSync(process.execPath, [SCRIPT, manifest], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Capture corpus: NOT READY/);
  assert.match(result.stdout, /Held-out benchmark size: 1 \/ 300 samples/);
  assert.doesNotMatch(result.stdout, /must-not-be-printed|poolside-corpus-|manifest\.json/);
});

test('corpus command can emit a machine-readable aggregate report', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-corpus-json-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const manifest = path.join(directory, 'manifest.json');
  fs.writeFileSync(manifest, JSON.stringify({ version: 1, samples: [] }));
  const result = spawnSync(process.execPath, [SCRIPT, manifest, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ready, false);
  assert.equal(report.benchmarkSamples, 0);
  assert.ok(Array.isArray(report.gates));
});
