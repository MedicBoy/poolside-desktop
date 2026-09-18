const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createScreenReader, classifyText } = require('../src/game-screen.cjs');

test('unrecognized or incomplete labels cannot establish a usable game screen', () => {
  for (const text of ['', '8 Ball Pool', 'Play', 'Account logged in', 'Prize', 'Play 1 on 1']) assert.equal(classifyText(text), 'unknown');
});
test('local OCR recognizes reference and held-out recorded screens; unreadable loading stays unknown', { timeout: 60000 }, async () => {
  const reader = await createScreenReader();
  try {
    for (const [file, expected] of [
      ['loading', 'unknown'],
      ['connecting', 'connecting'],
      ['lobby', 'lobby'],
      ['lucky', 'lucky-promotion'],
      ['table', 'table-selection'],
      ['recorded-lobby', 'lobby'],
      ['recorded-table', 'table-selection']
    ]) {
      const result = await reader.inspect(path.join(__dirname, 'fixtures', `${file}.png`));
      assert.equal(result.state, expected, file);
    }
  } finally {
    await reader.close();
  }
});
