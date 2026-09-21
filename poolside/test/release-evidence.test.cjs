const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { validate, FORMAT, REQUIRED_REPORTS } = require('../scripts/check-release-evidence.cjs');

/** @returns {any} */
function draft() {
  return {
    format: FORMAT,
    version: '0.3.11',
    commit: 'a'.repeat(40),
    channel: 'development-preview',
    status: 'draft',
    artifacts: [],
    reports: [],
    screenshots: [],
    matrix: [],
    signoffs: []
  };
}

test('draft evidence structure validates without implying release approval', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-evidence-'));
  try {
    assert.deepEqual(validate(draft(), root), []);
    assert.ok(validate(draft(), root, true).some(error => error.includes('approved status')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('evidence paths and hashes reject traversal, missing, tampering, and unreviewed screenshots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-evidence-'));
  try {
    const contents = Buffer.from('redacted test report');
    const target = path.join(root, 'report.txt');
    fs.writeFileSync(target, contents);
    const sha256 = crypto.createHash('sha256').update(contents).digest('hex');
    const manifest = draft();
    manifest.reports.push({ kind: 'tests', path: 'report.txt', sha256 });
    assert.deepEqual(validate(manifest, root), []);
    manifest.reports[0].path = '../report.txt';
    assert.ok(validate(manifest, root).some(error => error.includes('safe relative')));
    manifest.reports[0].path = 'report.txt';
    fs.writeFileSync(target, 'changed');
    assert.ok(validate(manifest, root).some(error => error.includes('SHA-256 mismatch')));
    manifest.screenshots.push({ path: 'report.txt', sha256 });
    assert.ok(validate(manifest, root).some(error => error.includes('explicit secret/privacy review')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a fully evidenced candidate passes and approval without evidence fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-evidence-'));
  try {
    function file(name) {
      const content = Buffer.from(`redacted evidence ${name}`);
      fs.writeFileSync(path.join(root, name), content);
      return { path: name, sha256: crypto.createHash('sha256').update(content).digest('hex') };
    }
    const manifest = draft();
    manifest.status = 'approved';
    manifest.artifacts = [
      { ...file('app.exe'), signature: 'verified', signer: 'Example Publisher', signatureReport: file('signature.txt') }
    ];
    manifest.reports = REQUIRED_REPORTS.map(kind => ({ kind, ...file(`${kind}.txt`) }));
    manifest.screenshots = [
      { ...file('redacted.png'), privacyReviewed: true, reviewer: 'QA reviewer', reviewedAt: '2026-09-21T10:00:00Z' }
    ];
    manifest.matrix = [{ configuration: 'Windows 11 x64 25H2, 100% DPI', status: 'pass', report: file('matrix.txt') }];
    manifest.signoffs = ['product', 'qa', 'security', 'release'].map(role => ({
      role,
      name: `${role} reviewer`,
      at: '2026-09-21T10:00:00Z',
      decision: 'approve'
    }));
    assert.deepEqual(validate(manifest, root, true), []);
    manifest.reports.pop();
    assert.ok(validate(manifest, root).some(error => error.includes('Missing reproducibility report')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
