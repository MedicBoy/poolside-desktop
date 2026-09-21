const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CAPABILITIES, buildCapabilityReport } = require('../src/capability-registry.cjs');
const { expectedFiles } = require('../scripts/product-truth.cjs');
const { validate } = require('../scripts/check-work-items.cjs');

test('capability IDs and status/flag contracts are coherent', () => {
  assert.equal(new Set(CAPABILITIES.map(item => item.id)).size, CAPABILITIES.length);
  assert.ok(CAPABILITIES.length >= 10);
  for (const item of CAPABILITIES) {
    assert.match(item.id, /^[a-z]+(?:-[a-z]+)*$/);
    assert.ok(['available', 'limited', 'dry-run', 'unavailable'].includes(item.mode));
    assert.ok(
      ['designed', 'implemented', 'fixture-proven', 'integration-proven', 'live-validated', 'release-proven'].includes(item.validation)
    );
    assert.ok(['on', 'dry-run', 'off'].includes(item.flag));
    assert.ok(item.detail.length > 20);
    if (item.mode === 'unavailable') assert.equal(item.flag, 'off');
    if (item.mode === 'dry-run') assert.equal(item.flag, 'dry-run');
  }
  // Capabilities that do not exist at all: nothing may claim them, whatever else is built.
  for (const id of ['authentication-verification', 'live-game-input', 'match-accounting', 'signed-installer', 'automatic-updates']) {
    assert.equal(CAPABILITIES.find(item => item.id === id)?.mode, 'unavailable');
  }
  // Pairing is the one that moved: two of your own accounts can be coordinated locally and the pairing judged
  // from the two sessions' own screen readings, which is `limited` — it is not pairing on the game service and
  // a local reading is evidence rather than proof, which is why it cannot be `available`.
  assert.equal(CAPABILITIES.find(item => item.id === 'matchmaking-pairing')?.mode, 'limited');
  assert.equal(CAPABILITIES.find(item => item.id === 'matchmaking-pairing')?.validation, 'fixture-proven');
});

test('generated report matches registry and package version exactly', () => {
  for (const [file, expected] of expectedFiles()) assert.equal(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), expected);
  const report = buildCapabilityReport(require('../package.json').version);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'capabilities.json'), 'utf8')), report);
});

test('all roadmap work items have valid traceable evidence contracts', () => assert.deepEqual(validate(), []));

test('register refuses unsupported completion and acceptance drift', () => {
  const entries = structuredClone(require('../docs/work-items.json'));
  const b1 = entries.find(item => item.id === 'B1');
  const a1 = entries.find(item => item.id === 'A1');
  const a3 = entries.find(item => item.id === 'A3');
  assert.ok(b1 && a1 && a3);
  b1.status = 'complete';
  assert.match(validate(entries).join(' '), /B1: complete requires evidence/);
  a1.status = 'open';
  assert.match(validate(entries).join(' '), /A2: complete item depends on unfinished work/);
  a3.acceptance = 'unsupported claim';
  assert.match(validate(entries).join(' '), /A3: acceptance drifted/);
});

test('About and diagnostics consume the public registry and source docs point to it', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'renderer.js'), 'utf8');
  const snapshot = fs.readFileSync(path.join(__dirname, '..', 'src', 'workspace-snapshot.cjs'), 'utf8');
  const diagnostics = fs.readFileSync(path.join(__dirname, '..', 'src', 'diagnostics-bundle.cjs'), 'utf8');
  assert.match(html, /id="view-about"/);
  assert.match(renderer, /state\.capabilityReport/);
  assert.match(snapshot, /buildCapabilityReport\(workspace\.version\)/);
  assert.match(diagnostics, /payload\.capabilityReport = buildCapabilityReport\(current\.version\)/);
  for (const file of ['README.md', 'docs/architecture.md', 'docs/adr/0011-game-automation-gaps.md']) {
    assert.match(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), /CAPABILITIES\.md/);
  }
  assert.match(fs.readFileSync(path.join(__dirname, '..', '..', 'INCOMPLETE_WORK.md'), 'utf8'), /CAPABILITIES\.md/);
});
