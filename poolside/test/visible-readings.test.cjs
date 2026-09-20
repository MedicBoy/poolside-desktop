const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVisibleReadings } = require('../src/visible-readings.cjs');
test('visible readings require an explicit nearby account-value label', () => {
  const found = parseVisibleReadings('Coins: 1,234,567 Cash 75 Rank: 19 Trophies 4,200', '2026-09-20T12:00:00.000Z');
  assert.equal(found.coinBalance.value, 1234567);
  assert.equal(found.cash.value, 75);
  assert.equal(found.rank.value, 19);
  assert.equal(found.trophies.value, 4200);
  assert.deepEqual(parseVisibleReadings('Entry fee 500 prize 1000'), {});
});
