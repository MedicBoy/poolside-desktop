const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAmount, balanceGroups, cellsFromBlocks, readingsFromCells, BALANCE_BAND } = require('../src/reading-regions.cjs');

// The word boxes below are the ones a live capture of the real play surface produced, scaled to the
// 1200 px frame the recogniser is handed. Pinning them here means a change to the band, the grouping
// rule, or the parser has to disagree with an observation rather than with a guess.
const FRAME = { width: 1200, height: 801 };
const LIVE_WORDS = [
  { text: '2', box: { x: 547, y: 12, width: 39, height: 46 }, confidence: 92 },
  { text: '3238', box: { x: 945, y: 70, width: 44, height: 12 }, confidence: 91 },
  { text: '4120', box: { x: 1061, y: 71, width: 44, height: 11 }, confidence: 84 },
  { text: '650', box: { x: 1111, y: 71, width: 28, height: 11 }, confidence: 93 },
  { text: '362', box: { x: 1145, y: 71, width: 28, height: 11 }, confidence: 96 }
];

test('a plain figure keeps its exact value', () => {
  assert.deepEqual(parseAmount('3238'), { value: 3238, exact: true });
  assert.deepEqual(parseAmount('4 120 650 362'), { value: 4120650362, exact: true });
  assert.deepEqual(parseAmount('1,234'), { value: 1234, exact: true });
  assert.deepEqual(parseAmount('0'), { value: 0, exact: true });
});

test('an abbreviated figure is marked inexact rather than trusted as the balance', () => {
  assert.deepEqual(parseAmount('3.23k'), { value: 3230, exact: false });
  assert.deepEqual(parseAmount('4.12B'), { value: 4120000000, exact: false });
  assert.deepEqual(parseAmount('1.5M'), { value: 1500000, exact: false });
});

test('text that is not a figure is refused', () => {
  for (const input of ['', '   ', 'Coins', '3.23.4', '.', ',,', '12a4', 'x123', null, undefined, 42]) {
    assert.equal(parseAmount(input), null, `expected ${JSON.stringify(input)} to be refused`);
  }
});

test('a figure longer than a balance can be is refused rather than rounded', () => {
  assert.equal(parseAmount('1234567890123456789'), null);
});

test('the two balances are split apart, in the order the game draws them', () => {
  const groups = balanceGroups(LIVE_WORDS, FRAME);
  assert.deepEqual(
    groups.map(group => group.text),
    ['3238', '4120650362']
  );
});

test('the level badge and the countdown are outside the band', () => {
  const outside = [
    { text: '124', box: { x: 250, y: 70, width: 30, height: 12 }, confidence: 90 },
    { text: '22', box: { x: 600, y: 70, width: 20, height: 12 }, confidence: 90 }
  ];
  assert.deepEqual(balanceGroups(outside, FRAME), []);
  assert.equal(BALANCE_BAND.left, 0.7);
});

test('a number split across words is only as certain as its weakest word', () => {
  const readings = readingsFromCells(LIVE_WORDS, FRAME, '2026-09-19T22:07:23.610Z');
  assert.equal(readings.cash.value, 3238);
  assert.equal(readings.cash.confidence, 0.91);
  assert.equal(readings.cash.exact, true);
  assert.equal(readings.coins.value, 4120650362);
  assert.equal(readings.coins.confidence, 0.84, 'the 84 % word caps the whole figure');
});

test('a frame with no balances reports none rather than zero', () => {
  assert.deepEqual(readingsFromCells([], FRAME), {});
  assert.deepEqual(readingsFromCells(null, FRAME), {});
});

test('a balance read from a rounded header figure is not presented as exact', () => {
  const header = [
    { text: '3.23k', box: { x: 945, y: 70, width: 44, height: 12 }, confidence: 95 },
    { text: '4.12B', box: { x: 1061, y: 71, width: 44, height: 11 }, confidence: 95 }
  ];
  const readings = readingsFromCells(header, FRAME, '2026-09-19T22:07:23.610Z');
  assert.equal(readings.cash.value, 3230);
  assert.equal(readings.cash.exact, false);
  assert.equal(readings.coins.value, 4120000000);
  assert.equal(readings.coins.exact, false);
});

test('the block tree is flattened into positioned cells', () => {
  const blocks = [
    {
      paragraphs: [
        {
          lines: [
            {
              words: [
                { text: '3238', bbox: { x0: 945, y0: 70, x1: 989, y1: 82 }, confidence: 91 },
                { text: '   ', bbox: { x0: 990, y0: 70, x1: 995, y1: 82 }, confidence: 0 }
              ]
            }
          ]
        }
      ]
    }
  ];
  const cells = cellsFromBlocks(blocks);
  assert.equal(cells.length, 1, 'a blank word is not a cell');
  assert.deepEqual(cells[0].box, { x: 945, y: 70, width: 44, height: 12 });
  assert.equal(cells[0].confidence, 91);
  assert.deepEqual(cellsFromBlocks(null), []);
});
