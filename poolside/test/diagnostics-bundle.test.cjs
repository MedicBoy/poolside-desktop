const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const telemetry = require('../src/dashboard-telemetry.cjs');
const bundle = require('../src/diagnostics-bundle.cjs');
const redaction = require('../src/telemetry-redaction.cjs');

const accounts = [{ id: '11111111-2222-4333-8444-555555555555', name: 'Private Main', status: 'ready', profile: null }];

test('diagnostics bundle writes only a scanned, anonymised local document', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-diagnostics-'));
  try {
    const snapshot = {
      accounts,
      telemetry: telemetry.build(accounts, { version: '0.1.0', now: Date.UTC(2026, 8, 18, 13, 0, 0) }),
      timeline: {
        entries: [
          {
            at: '2026-09-18T13:00:00.000Z',
            source: 'activity',
            accountName: 'Private Main',
            message: 'Private Main saw 192.168.1.40 at C:\\Users\\nicho'
          }
        ]
      }
    };
    assert.equal(bundle.directory(root), path.join(root, 'diagnostics'));
    const prepared = bundle.prepare(snapshot);
    assert.equal(prepared.clean, true);
    assert.equal(prepared.entries, 1);
    const result = bundle.write(root, prepared, { now: new Date('2026-09-18T13:01:02.003Z') });
    assert.equal(result.fileName, 'poolside-diagnostics-2026-09-18_13-01-02-003.json');
    assert.ok(result.bytes > 0);
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'diagnostics', result.fileName), 'utf8'));
    assert.equal(saved.format, 'poolside-diagnostics/v1');
    assert.equal(saved.payload.capabilityReport.format, 'poolside-capabilities/v1');
    assert.equal(saved.payload.capabilityReport.capabilities.find(item => item.id === 'live-game-input').flag, 'off');
    assert.deepEqual(redaction.findSecrets(saved, { forbidden: ['Private Main'] }), []);
    assert.equal(JSON.stringify(saved).includes('Private Main'), false);
    assert.equal(JSON.stringify(saved).includes('192.168.1.40'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('diagnostics bundle refuses to overwrite a timestamp collision', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-diagnostics-'));
  try {
    const prepared = bundle.prepare({ accounts: [], telemetry: telemetry.build([]), timeline: { entries: [] } });
    const now = new Date('2026-09-18T13:01:02.003Z');
    bundle.write(root, prepared, { now });
    assert.throws(() => bundle.write(root, prepared, { now }), /already exists/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
