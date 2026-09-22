const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createScreenReader, classifyText } = require('../src/game-screen.cjs');

test('unrecognized or incomplete labels cannot establish a usable game screen', () => {
  for (const text of ['', '8 Ball Pool', 'Play', 'Account logged in', 'Prize', 'Play 1 on 1'])
    assert.equal(classifyText(text), 'unrecognized');
});
test(
  'local OCR recognizes reference and held-out recorded screens; unreadable loading remains unrecognized',
  { timeout: 60000 },
  async () => {
    let visualChecks = 0;
    const reader = await createScreenReader({
      tableMatcher: {
        match: async () => {
          visualChecks++;
          return 'Bangkok';
        }
      }
    });
    try {
      for (const [file, expected] of [
        ['loading', 'unrecognized'],
        ['connecting', 'connecting'],
        ['lobby', 'lobby'],
        ['lucky', 'lucky-promotion'],
        ['table', 'table-selection'],
        ['recorded-lobby', 'lobby'],
        ['recorded-table', 'table-selection']
      ]) {
        const result = await reader.inspect(path.join(__dirname, 'fixtures', `${file}.png`));
        assert.equal(result.state, expected, file);
        assert.ok(result.stages.totalMs >= result.stages.firstOcrMs, `${file}: measured total covers first OCR`);
        assert.ok(Object.values(result.stages).every(value => Number.isFinite(value) && value >= 0));
        if (expected === 'table-selection') {
          assert.ok(result.visibleTables.includes('Bangkok'));
          assert.deepEqual(result.tableMatch, { table: 'Bangkok', method: 'local-evidence' });
        } else {
          assert.equal(result.tableMatch, null);
        }
      }
      assert.ok(visualChecks >= 2, 'table screens consulted the local visual matcher');
    } finally {
      await reader.close();
    }
  }
);
