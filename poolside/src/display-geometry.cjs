// How a rectangle relates to a monitor layout: how much of it is visible, whether a user can reach it,
// and which display it belongs to.
//
// Split from geometry.cjs so "is this window reachable" is a separate question from "what should be
// restored". Pure module: no Electron, no fs.

const TITLE_BAR_HEIGHT = 24;
const MIN_VISIBLE_WIDTH = 120;

/** @typedef {{x: number, y: number, width: number, height: number}} Rect */
/** @typedef {{id?: number, primary?: boolean, workArea: Rect}} Display */

/** How much of the window lies inside a display's work area, in pixels².
 * @param {Rect} bounds @param {Rect} area */
function visibleArea(bounds, area) {
  const width = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
  const height = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
  if (width <= 0 || height <= 0) return 0;
  return width * height;
}

/**
 * Can the user actually get hold of this window? A title bar inside the work area and a usable slice
 * of width visible. Anything else is a window the user cannot move or close.
 */
function isReachable(bounds, area) {
  const titleRow = bounds.y + Math.round(TITLE_BAR_HEIGHT / 2);
  if (titleRow < area.y || titleRow > area.y + area.height) return false;
  const visibleWidth = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
  return visibleWidth >= MIN_VISIBLE_WIDTH;
}

/**
 * The display a remembered window belongs to: the one it overlaps most, or null when it overlaps none.
 * @param {{x: number, y: number, width: number, height: number}} bounds
 * @param {{id?: number, primary?: boolean, workArea: {x: number, y: number, width: number, height: number}}[]} displays
 */
function pickDisplay(bounds, displays) {
  /** @type {Display|null} */
  let best = null;
  let bestArea = 0;
  for (const display of displays) {
    if (!display || !display.workArea) continue;
    const area = visibleArea(bounds, display.workArea);
    if (area > bestArea) {
      bestArea = area;
      best = display;
    }
  }
  return best;
}

/** @param {number} value @param {number} low @param {number} high */
function clamp(value, low, high) {
  if (high < low) return low;
  return Math.min(Math.max(value, low), high);
}

module.exports = { visibleArea, isReachable, pickDisplay, clamp, TITLE_BAR_HEIGHT, MIN_VISIBLE_WIDTH };
