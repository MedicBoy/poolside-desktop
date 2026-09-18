const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tileGeometry, rectFor, columnsFor, WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT } = require('../src/layout.cjs');

const AREA = { x: 0, y: 0, width: 1920, height: 1040 };

test('a single window keeps the standard minimum (regression: D7)', () => {
  const geometry = tileGeometry(1, AREA);
  assert.equal(geometry.cols, 1);
  assert.equal(geometry.rows, 1);
  assert.equal(geometry.tileWidth, 1920);
  assert.equal(geometry.tileHeight, 1040);
  assert.equal(geometry.minimumWidth, WINDOW_MIN_WIDTH);
  assert.equal(geometry.minimumHeight, WINDOW_MIN_HEIGHT);
  assert.equal(geometry.cramped, false);
});

test('arranging eight windows restores the standard minimum when reduced to one (regression: D7)', () => {
  const many = tileGeometry(8, AREA);
  assert.equal(many.cols, 2);
  assert.equal(many.rows, 4);
  assert.equal(many.tileWidth, 960);
  assert.equal(many.tileHeight, 260);
  // The minimum must follow the tile, never exceed it, or setBounds is clamped and rows overlap.
  assert.equal(many.minimumWidth, 660);
  assert.equal(many.minimumHeight, 260);
  assert.ok(many.minimumHeight <= many.tileHeight);
  const backToOne = tileGeometry(1, AREA);
  assert.equal(backToOne.minimumWidth, WINDOW_MIN_WIDTH);
  assert.equal(backToOne.minimumHeight, WINDOW_MIN_HEIGHT);
});

test('the minimum never exceeds the tile for any count', () => {
  for (const count of [1, 2, 3, 4, 5, 6, 8, 12, 16]) {
    const geometry = tileGeometry(count, AREA);
    assert.ok(geometry.minimumWidth <= geometry.tileWidth, `width for ${count}`);
    assert.ok(geometry.minimumHeight <= geometry.tileHeight, `height for ${count}`);
    assert.ok(geometry.cols * geometry.rows >= count, `grid covers ${count}`);
  }
});

test('cramped grids are reported rather than silently clamped', () => {
  assert.equal(tileGeometry(2, AREA).cramped, false);
  assert.equal(tileGeometry(8, AREA).cramped, true);
});

test('tiles tile the work area without gaps or overlap', () => {
  const count = 5;
  const geometry = tileGeometry(count, AREA);
  const rects = Array.from({ length: count }, (_, index) => rectFor(index, geometry, AREA));
  for (const rect of rects) {
    assert.ok(rect.x >= AREA.x && rect.y >= AREA.y, 'inside the area');
    assert.ok(rect.x + rect.width <= AREA.x + AREA.width, 'within width');
    assert.ok(rect.y + rect.height <= AREA.y + AREA.height, 'within height');
  }
  const seen = new Set(rects.map(rect => `${rect.x},${rect.y}`));
  assert.equal(seen.size, count, 'no two windows share a position');
  assert.deepEqual(rects[0], { x: 0, y: 0, width: 960, height: 346 });
  assert.deepEqual(rects[1], { x: 960, y: 0, width: 960, height: 346 });
  assert.deepEqual(rects[2], { x: 0, y: 346, width: 960, height: 346 });
  assert.deepEqual(rects[4], { x: 0, y: 692, width: 960, height: 346 });
});

test('geometry respects a non-zero work-area origin (multi-monitor)', () => {
  const offset = { x: -1920, y: 120, width: 1920, height: 1000 };
  const geometry = tileGeometry(2, offset);
  assert.deepEqual(rectFor(0, geometry, offset), { x: -1920, y: 120, width: 960, height: 1000 });
  assert.deepEqual(rectFor(1, geometry, offset), { x: -960, y: 120, width: 960, height: 1000 });
});

test('invalid input is rejected rather than producing a broken layout', () => {
  assert.throws(() => tileGeometry(0, AREA), /positive integer/);
  assert.throws(() => tileGeometry(1.5, AREA), /positive integer/);
  assert.throws(() => tileGeometry(2, { x: 0, y: 0, width: 0, height: 100 }), /work area/);
  assert.throws(() => tileGeometry(2, null), /work area/);
  assert.equal(columnsFor(1), 1);
  assert.equal(columnsFor(9), 2);
});
