const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recordNewState } = require('../src/inspection.cjs');

const PNG = Buffer.from('not-a-real-png-but-a-buffer');
const FRAME = { width: 1200, height: 801 };
const TIMING = { surfaceMs: 10, recognitionMs: 20, totalMs: 30 };

function lab(existing = []) {
  const recorded = [];
  return {
    recorded,
    states: ['lobby', 'shop', 'table-selection'],
    list: () => existing.concat(recorded),
    record: input => {
      recorded.push({ expectedState: input.expectedState, observedState: input.observed.state, cohort: input.cohort });
      return { id: 'sample-1' };
    }
  };
}

test('a state the corpus has never seen is set aside as unreviewed evidence', () => {
  const store = lab();
  const id = recordNewState(store, { png: PNG, result: { state: 'lobby' }, frame: FRAME, timing: TIMING });
  assert.equal(id, 'sample-1');
  assert.deepEqual(store.recorded, [{ expectedState: 'lobby', observedState: 'lobby', cohort: 'evidence' }]);
});

test('a state already in the corpus is not recorded again', () => {
  const store = lab([{ expectedState: 'shop', observedState: 'lobby' }]);
  assert.equal(recordNewState(store, { png: PNG, result: { state: 'lobby' }, frame: FRAME, timing: TIMING }), null);
  assert.deepEqual(store.recorded, []);
});

test('an unrecognised frame is never filed under a state of its own', () => {
  const store = lab();
  assert.equal(recordNewState(store, { png: PNG, result: { state: 'unrecognized' }, frame: FRAME, timing: TIMING }), null);
  assert.deepEqual(store.recorded, []);
});

test('table selection waits for a person to name the intended table', () => {
  const store = lab();
  assert.equal(recordNewState(store, { png: PNG, result: { state: 'table-selection' }, frame: FRAME, timing: TIMING }), null);
  assert.deepEqual(store.recorded, []);
});

test('a state outside the supported set is refused', () => {
  const store = lab();
  assert.equal(recordNewState(store, { png: PNG, result: { state: 'inspecting' }, frame: FRAME, timing: TIMING }), null);
  assert.deepEqual(store.recorded, []);
});

test('a missing capture lab is not an error, and a failing write never loses the observation', () => {
  assert.equal(recordNewState(undefined, { png: PNG, result: { state: 'lobby' }, frame: FRAME, timing: TIMING }), null);
  const failing = {
    states: ['lobby'],
    list: () => [],
    record: () => {
      throw new Error('disk full');
    }
  };
  assert.equal(recordNewState(failing, { png: PNG, result: { state: 'lobby' }, frame: FRAME, timing: TIMING }), null);
});
