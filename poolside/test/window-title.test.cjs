const { test } = require('node:test');
const assert = require('node:assert/strict');
const { windowTitleFor } = require('../src/window-title.cjs');

test('a session window shows the address it last reported', () => {
  assert.equal(windowTitleFor('Newfie', '198.105.121.200'), 'Poolside · Newfie · 198.105.121.200');
});

test('with no address yet the title is just the account', () => {
  for (const ip of [null, undefined, '']) assert.equal(windowTitleFor('Gmail', ip), 'Poolside · Gmail');
  assert.equal(windowTitleFor('', '1.2.3.4'), 'Poolside · Account · 1.2.3.4');
  assert.equal(windowTitleFor(undefined, undefined), 'Poolside · Account');
});
