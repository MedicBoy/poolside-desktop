const test = require('node:test');
const assert = require('node:assert/strict');
const { append, LIMIT } = require('../src/screen-history.cjs');
test('screen history keeps state changes only and remains bounded', () => {
  let history = append([], { state: 'lobby', score: 0.7, observedAt: '2026-09-20T10:00:00Z' });
  history = append(history, { state: 'lobby', score: 0.8, observedAt: '2026-09-20T10:01:00Z' });
  history = append(history, { state: 'shop', score: 0.9, observedAt: '2026-09-20T10:02:00Z' });
  assert.equal(history.length, 2);
  assert.equal(history[0].state, 'shop');
  for (let n = 0; n < LIMIT + 2; n++) history = append(history, { state: `state-${n}`, observedAt: `2026-09-20T10:${n}:00Z` });
  assert.equal(history.length, LIMIT);
});
