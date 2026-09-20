const test = require('node:test');
const assert = require('node:assert/strict');
const { readingStatus, describeReadings, CONFIDENCE_FLOOR, STALE_AFTER_MS } = require('../src/reading-status.cjs');

const NOW = Date.parse('2026-09-20T12:00:00.000Z');
const at = offsetMs => new Date(NOW - offsetMs).toISOString();

test('a fresh, confident reading is current; an unsure one is uncertain, not current', () => {
  assert.equal(readingStatus({ confidence: 0.95, observedAt: at(1000) }, NOW), 'current');
  assert.equal(readingStatus({ confidence: CONFIDENCE_FLOOR, observedAt: at(1000) }, NOW), 'current');
  assert.equal(readingStatus({ confidence: CONFIDENCE_FLOOR - 0.01, observedAt: at(1000) }, NOW), 'uncertain');
  assert.equal(readingStatus({ observedAt: at(1000) }, NOW), 'uncertain', 'a reading with no confidence is not trusted');
});

test('an old reading is stale, and a value with no usable time can never be current', () => {
  assert.equal(readingStatus({ confidence: 0.99, observedAt: at(STALE_AFTER_MS) }, NOW), 'current');
  assert.equal(readingStatus({ confidence: 0.99, observedAt: at(STALE_AFTER_MS + 1) }, NOW), 'stale');
  assert.equal(readingStatus({ confidence: 0.99 }, NOW), 'stale');
  assert.equal(readingStatus({ confidence: 0.99, observedAt: 'not a time' }, NOW), 'stale');
});

test('stamping keeps the value, labels the status, and never mutates the input', () => {
  const input = {
    coinBalance: { label: 'Coins', value: 1234, confidence: 0.9, observedAt: at(1000), source: 'labelled local OCR' },
    rank: { label: 'Rank', value: 19, confidence: 0.5, observedAt: at(1000), source: 'labelled local OCR' },
    cash: { label: 'Cash', value: 7.5, confidence: 0.9, observedAt: at(1000), source: 'labelled local OCR' }
  };
  const stamped = describeReadings(input, NOW);
  assert.deepEqual(Object.keys(stamped), ['coinBalance', 'rank'], 'a non-integer value is dropped, not shown as a figure');
  assert.equal(stamped.coinBalance.status, 'current');
  assert.equal(stamped.coinBalance.value, 1234);
  assert.equal(stamped.rank.status, 'uncertain');
  assert.match(stamped.rank.statusLabel, /Uncertain/);
  assert.equal(input.coinBalance.status, undefined, 'the stored reading is left alone');
});

test('nothing here throws, whatever it is handed', () => {
  for (const value of [undefined, null, 0, 'x', [], { a: null }, { a: {} }, { a: { value: NaN } }]) {
    assert.doesNotThrow(() => describeReadings(/** @type {any} */ (value), NOW));
    assert.doesNotThrow(() => readingStatus(/** @type {any} */ (value), NOW));
  }
  assert.deepEqual(describeReadings(/** @type {any} */ (null), NOW), {});
});
