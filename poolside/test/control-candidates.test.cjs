const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createScreenReader } = require('../src/game-screen.cjs');
const { buildObservation } = require('../src/observation-contract.cjs');
const { controlCandidates } = require('../src/control-candidates.cjs');
const { resolveControl } = require('../src/control-input-gate.cjs');

test('recorded lobby anchors are visible but do not authorize input', { timeout: 60000 }, async () => {
  const reader = await createScreenReader();
  try {
    for (const file of ['lobby', 'recorded-lobby']) {
      const result = await reader.inspect(path.join(__dirname, 'fixtures', `${file}.png`));
      const frame = { width: 1210, height: 804, matched: true, pageRect: { x: 10, y: 20, width: 1210, height: 804 } };
      const observation = buildObservation(result, { png: Buffer.from(file), generation: 2, frame, timing: {} });
      assert.equal(observation.controls.length, 1, file);
      assert.equal(observation.controls[0].name, 'open-1-on-1');
      assert.equal(observation.controls[0].verified, false);
      assert.equal(observation.inputReady, false);
      assert.equal(
        resolveControl(observation, frame, {
          name: 'open-1-on-1',
          screen: 'lobby',
          generation: 2,
          now: Date.parse(result.observedAt)
        }).ok,
        false
      );
    }
    const table = await reader.inspect(path.join(__dirname, 'fixtures', 'table.png'));
    assert.deepEqual(table.controls, []);
  } finally {
    await reader.close();
  }
});

test('unlocated, ambiguous, or weak OCR anchors are rejected', () => {
  const bounds = { width: 1200, height: 800 };
  const cell = { text: 'Play', confidence: 96, box: { x: 270, y: 370, width: 90, height: 45 } };
  assert.equal(controlCandidates([cell], bounds, 'lobby').length, 1);
  assert.deepEqual(controlCandidates([cell], bounds, 'table-selection'), []);
  assert.deepEqual(controlCandidates([{ ...cell, confidence: 70 }], bounds, 'lobby'), []);
  assert.deepEqual(controlCandidates([{ ...cell, box: { ...cell.box, x: 800 } }], bounds, 'lobby'), []);
  assert.deepEqual(controlCandidates([{ ...cell, box: { ...cell.box, x: -1 } }], bounds, 'lobby'), []);
});

test('input gate requires fresh, verified geometry and an unchanged frame', () => {
  const now = Date.now();
  const frame = { width: 1200, height: 800, matched: true, pageRect: { x: 20, y: 30, width: 600, height: 400 } };
  const control = {
    name: 'open-1-on-1',
    screen: 'lobby',
    verified: true,
    visible: true,
    disabled: false,
    confidence: 0.98,
    bounds: { x: 0.2, y: 0.4, width: 0.1, height: 0.1 }
  };
  const observation = {
    observedAt: new Date(now).toISOString(),
    screen: { state: 'lobby', confidence: 0.95 },
    contradictions: [],
    capture: { generation: 4, sha256: 'a'.repeat(64), ...frame },
    controls: [control]
  };
  const options = { name: control.name, screen: 'lobby', generation: 4, now };
  assert.deepEqual(resolveControl(observation, frame, options), { ok: true, pagePoint: { x: 170, y: 210 } });
  const cases = /** @type {[any, string][]} */ ([
    [{ controls: [{ ...control, verified: false }] }, 'control-unverified'],
    [{ controls: [control, control] }, 'control-ambiguous'],
    [{ contradictions: ['table-selection'] }, 'screen-uncertain'],
    [{ screen: { state: 'lobby' } }, 'screen-uncertain'],
    [{ capture: { ...observation.capture, generation: 5 } }, 'generation-changed'],
    [{ observedAt: new Date(now - 3000).toISOString() }, 'stale-observation'],
    [{ controls: [{ ...control, bounds: { ...control.bounds, x: 0.95 } }] }, 'control-outside-surface']
  ]);
  for (const [change, reason] of cases) assert.equal(resolveControl({ ...observation, ...change }, frame, options).reason, reason);
  assert.equal(resolveControl(observation, { ...frame, pageRect: { ...frame.pageRect, x: 21 } }, options).reason, 'frame-moved');
});
