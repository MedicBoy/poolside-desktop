// Remembered window geometry: restore, clamp, and per-monitor bounds.
//
// Pure: windows.cjs supplies the live displays and applies the result, so the rules can be tested
// against invented monitor layouts — including the one that matters most, a remembered position on a
// display that is no longer attached.
//
// Defect history: arrange() used to lower every window's minimum size permanently (the minimum now
// tracks the tile, in layout.cjs). Restoring geometry has to be as careful in the other direction — a
// remembered size below the current minimum is grown rather than applied, or a window comes back
// unable to show its own content after a layout change.
//
// Directly related helpers live in display-geometry.cjs. Pure module: no Electron, no fs.

const { clamp, isReachable, pickDisplay } = require('./display-geometry.cjs');

const MIN_SANE_SIZE = 200;
const MAX_SANE_SIZE = 10000;
const MAX_SANE_POSITION = 100000;

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** @param {number} value */
function isSaneInteger(value, limit) {
  return Number.isInteger(value) && Math.abs(value) <= limit;
}

/**
 * Keep a remembered record only if it is genuinely usable. Window geometry is disposable data: a
 * corrupt entry must degrade to "nothing remembered", never to a crash or an unusable window.
 * @param {unknown} value
 * @returns {{x: number, y: number, width: number, height: number, maximized: boolean} | null}
 */
function normaliseRemembered(value) {
  if (!isPlainObject(value)) return null;
  const { x, y, width, height } = value;
  if (!isSaneInteger(x, MAX_SANE_POSITION) || !isSaneInteger(y, MAX_SANE_POSITION)) return null;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width < MIN_SANE_SIZE || height < MIN_SANE_SIZE) return null;
  if (width > MAX_SANE_SIZE || height > MAX_SANE_SIZE) return null;
  return { x, y, width, height, maximized: value.maximized === true };
}

/**
 * Work out where a session window should come back, and whether that differs from what was remembered.
 *
 * `bounds: null` means nothing usable was remembered and the caller should use its own default — this is
 * not an error, it is the first run.
 *
 * @param {unknown} remembered
 * @param {import('./display-geometry.cjs').Display[]} [displays]
 * @param {{minimumWidth?: number, minimumHeight?: number}} [options]
 */
function restoreBounds(remembered, displays = [], options = {}) {
  const minimumWidth = typeof options.minimumWidth === 'number' ? options.minimumWidth : 660;
  const minimumHeight = typeof options.minimumHeight === 'number' ? options.minimumHeight : 560;
  const minimum = { width: minimumWidth, height: minimumHeight };
  const clean = normaliseRemembered(remembered);
  if (!clean) {
    return { bounds: null, displayId: null, adjusted: false, reason: 'nothing usable was remembered', maximized: false, minimum };
  }

  const notes = [];
  let { x, y, width, height } = clean;
  if (width < minimumWidth) {
    width = minimumWidth;
    notes.push(`width raised to the ${minimumWidth}px minimum`);
  }
  if (height < minimumHeight) {
    height = minimumHeight;
    notes.push(`height raised to the ${minimumHeight}px minimum`);
  }

  /** @type {import('./display-geometry.cjs').Display[]} */
  const list = (Array.isArray(displays) ? displays : []).filter(display => Boolean(display && display.workArea));
  if (!list.length) {
    return {
      bounds: { x, y, width, height },
      displayId: null,
      adjusted: notes.length > 0,
      reason: notes.join('; ') || null,
      maximized: clean.maximized,
      minimum
    };
  }

  const overlaps = pickDisplay({ x, y, width, height }, list);
  if (!overlaps) {
    // The monitor it was on is gone. Keep the size, put it somewhere the user can see it.
    const fallback = /** @type {import('./display-geometry.cjs').Display} */ (list.find(candidate => candidate.primary) || list[0]);
    const area = fallback.workArea;
    width = Math.min(width, Math.max(minimumWidth, area.width));
    height = Math.min(height, Math.max(minimumHeight, area.height));
    x = Math.round(area.x + (area.width - width) / 2);
    y = Math.round(area.y + (area.height - height) / 2);
    notes.push('the remembered display is not attached, so the window was centred on the primary display');
    return {
      bounds: { x, y, width, height },
      displayId: fallback.id ?? null,
      adjusted: true,
      reason: notes.join('; '),
      maximized: clean.maximized,
      minimum
    };
  }

  const area = overlaps.workArea;
  if (width > area.width) {
    width = Math.max(minimumWidth, area.width);
    notes.push(`width fitted to the ${area.width}px display`);
  }
  if (height > area.height) {
    height = Math.max(minimumHeight, area.height);
    notes.push(`height fitted to the ${area.height}px display`);
  }
  if (!isReachable({ x, y, width, height }, area)) {
    x = clamp(x, area.x, area.x + area.width - width);
    y = clamp(y, area.y, area.y + area.height - height);
    notes.push('moved back inside the display work area');
  }

  return {
    bounds: { x, y, width, height },
    displayId: overlaps.id ?? null,
    adjusted: notes.length > 0,
    reason: notes.join('; ') || null,
    maximized: clean.maximized,
    minimum
  };
}

/** What to remember about a live window, so the next open can restore it. */
function rememberBounds(bounds, options = {}) {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
    maximized: options.maximized === true,
    displayId: Number.isInteger(options.displayId) ? options.displayId : null,
    at: new Date(options.now === undefined ? Date.now() : options.now).toISOString()
  };
}

/** @param {ReturnType<typeof restoreBounds>} result */
function describeRestore(result) {
  if (!result.bounds) return 'no saved geometry yet, using the default size';
  return result.adjusted ? `restored with adjustments: ${result.reason}` : 'restored exactly as it was left';
}

module.exports = { restoreBounds, normaliseRemembered, rememberBounds, describeRestore, MIN_SANE_SIZE, MAX_SANE_SIZE };
