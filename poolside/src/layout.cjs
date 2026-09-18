// Pure layout arithmetic for game windows.
//
// Deliberately free of Electron imports so the geometry can be unit tested without a running app
// (see test/layout.test.cjs). main.cjs supplies the work area and applies the result.
//
// Defect history: arrange() used to call setMinimumSize(420, 360) and never restore it, so every
// window permanently lost its 660x560 minimum after one arrangement. The minimum now tracks the
// tile size and is restored to the standard value whenever a single window is arranged.

const WINDOW_MIN_WIDTH = 660;
const WINDOW_MIN_HEIGHT = 560;

// Below these tile sizes a grid is cramped enough to be worth warning about, but they are not
// enforced: forcing a minimum larger than the tile would push windows outside the grid.
const CRAMPED_WIDTH = 420;
const CRAMPED_HEIGHT = 360;

function isPositiveArea(area) {
  return Boolean(area) && Number.isFinite(area.width) && Number.isFinite(area.height) && area.width > 0 && area.height > 0;
}

function columnsFor(count) {
  return count <= 1 ? 1 : 2;
}

function tileGeometry(count, area) {
  if (!Number.isInteger(count) || count < 1) throw new Error('Window count must be a positive integer.');
  if (!isPositiveArea(area)) throw new Error('A work area with a positive width and height is required.');
  const cols = columnsFor(count);
  const rows = Math.ceil(count / cols);
  const tileWidth = Math.floor(area.width / cols);
  const tileHeight = Math.floor(area.height / rows);
  // Never let the minimum exceed the tile, or setBounds would be clamped and rows would overlap.
  const minimumWidth = count === 1 ? WINDOW_MIN_WIDTH : Math.min(WINDOW_MIN_WIDTH, tileWidth);
  const minimumHeight = count === 1 ? WINDOW_MIN_HEIGHT : Math.min(WINDOW_MIN_HEIGHT, tileHeight);
  return {
    cols,
    rows,
    tileWidth,
    tileHeight,
    minimumWidth,
    minimumHeight,
    cramped: tileWidth < CRAMPED_WIDTH || tileHeight < CRAMPED_HEIGHT
  };
}

function rectFor(index, geometry, area) {
  return {
    x: area.x + (index % geometry.cols) * geometry.tileWidth,
    y: area.y + Math.floor(index / geometry.cols) * geometry.tileHeight,
    width: geometry.tileWidth,
    height: geometry.tileHeight
  };
}

module.exports = { tileGeometry, rectFor, columnsFor, WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT, CRAMPED_WIDTH, CRAMPED_HEIGHT };
