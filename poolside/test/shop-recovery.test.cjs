const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ShopReturnGate } = require('../src/shop-recovery.cjs');
test('shop return requires five stable seconds and fires only once', () => {
  const gate = new ShopReturnGate();
  assert.equal(gate.observe('https://8ballpool.com/game', true, 0), false);
  assert.equal(gate.observe('https://8ballpool.com/game', true, 4999), false);
  assert.equal(gate.observe('https://8ballpool.com/game', true, 5000), true);
  gate.reset();
  assert.equal(gate.observe('https://8ballpool.com/game', true, 20000), false);
});
test('leaving shop, changing URL or navigating outside official origin cancels pending return', () => {
  for (const [url, shop] of [['https://8ballpool.com/game', false], ['https://8ballpool.com/shop', true], ['https://example.test', true]]) {
    const gate = new ShopReturnGate();
    gate.observe('https://8ballpool.com/game', true, 0);
    assert.equal(gate.observe(url, shop, 4000), false);
    assert.equal(gate.observe('https://8ballpool.com/game', true, 5000), false);
    assert.equal(gate.observe('https://8ballpool.com/game', true, 10000), true);
  }
});
