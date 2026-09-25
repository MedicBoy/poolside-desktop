const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildObservation } = require('../src/observation-contract.cjs');

const capture = { png: Buffer.from('frame one'), generation: 4, frame: { width: 1200, height: 720 }, timing: { surfaceMs: 12 } };

test('an observation ties a screen to its exact capture and preserves uncertainty', () => {
  const result = {
    state: 'table-selection',
    score: 0.93,
    observedAt: '2026-09-25T12:00:00.000Z',
    visibleTables: ['London', 'Unknown', 'London'],
    tableMatch: { table: 'London', method: 'local-evidence' },
    alternatives: [{ state: 'lobby', score: 0.8 }],
    readings: { coinBalance: { value: 2000, confidence: 0.73 } },
    stages: { firstOcrMs: 30 },
    ruleVersion: 'ocr-rules/123456789abc'
  };
  const observation = buildObservation(result, capture);
  assert.equal(observation.capture.sha256.length, 64);
  assert.notEqual(observation.capture.sha256, buildObservation(result, { ...capture, png: Buffer.from('frame two') }).capture.sha256);
  assert.equal(observation.capture.generation, 4);
  assert.deepEqual(observation.visibleTables, ['London']);
  assert.deepEqual(observation.contradictions, ['lobby']);
  assert.ok(observation.tableTarget);
  assert.equal(observation.tableTarget.confidence, null);
  assert.deepEqual(observation.controls, []);
  assert.equal(observation.inputReady, false);
  assert.equal(observation.timings.firstOcrMs, 30);
  assert.equal(observation.timings.surfaceMs, 12);
});

test('missing or malformed evidence cannot become a ready control', () => {
  const observation = buildObservation({ state: 'lobby', score: NaN, controls: [{ x: 10, y: 20 }], visibleTables: ['Fake'] }, capture);
  assert.equal(observation.screen.confidence, 0);
  assert.deepEqual(observation.visibleTables, []);
  assert.deepEqual(observation.controls, []);
  assert.equal(observation.ruleVersion, 'unknown');
  assert.equal(observation.inputReady, false);
});
