// Creating and measuring a session window: its remembered geometry, the displays that exist now, and
// the window options.
//
// Separated from windows.cjs because "where does this window open" is a different question from "what
// state is this session in", and because both modules have to stay inside the size ceiling.
//
// Geometry is captured from `getNormalBounds`, not `getBounds`: a maximized window reports the
// maximized rectangle, and restoring that would make un-maximizing impossible.

const { BrowserWindow, screen } = require('electron');
const { restoreBounds, rememberBounds, describeRestore } = require('./geometry.cjs');
const { WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT } = require('./layout.cjs');

const GAME_WINDOW_WIDTH = 1060;
const GAME_WINDOW_HEIGHT = 800;
const WINDOW_BACKGROUND = '#14171b';

/**
 * @param {{title: string, session: import('electron').Session, remembered: unknown, backgroundThrottling?: boolean}} options
 */
function createSessionWindow(options) {
  const { title, session, remembered, backgroundThrottling = false } = options;
  const restore = restoreBounds(remembered, screen.getAllDisplays(), {
    minimumWidth: WINDOW_MIN_WIDTH,
    minimumHeight: WINDOW_MIN_HEIGHT
  });
  // No remembered size means a first run: let Electron centre the default. x/y are only passed when
  // they were restored, because passing them from a default would pin the window to a corner.
  const size = restore.bounds || { width: GAME_WINDOW_WIDTH, height: GAME_WINDOW_HEIGHT };
  const window = new BrowserWindow({
    title,
    ...size,
    // The minimum is applied from the restore result, so a remembered window never comes back below
    // the size its content needs (the mirror image of defect D7, which lowered minimums and never put
    // them back).
    minWidth: restore.minimum.width,
    minHeight: restore.minimum.height,
    autoHideMenuBar: true,
    backgroundColor: WINDOW_BACKGROUND,
    webPreferences: {
      session,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling
    }
  });
  if (restore.maximized) window.maximize();
  return { window, restore };
}

/**
 * What to store about a live window so the next open can restore it.
 * @param {import('electron').BrowserWindow} window
 */
function captureGeometry(window) {
  if (!window || window.isDestroyed()) return null;
  const bounds = typeof window.getNormalBounds === 'function' ? window.getNormalBounds() : window.getBounds();
  /** @type {number|null} */
  let displayId = null;
  try {
    displayId = screen.getDisplayMatching(window.getBounds()).id;
  } catch {
    displayId = null;
  }
  return rememberBounds(bounds, { maximized: window.isMaximized(), displayId });
}

module.exports = { createSessionWindow, captureGeometry, describeRestore, GAME_WINDOW_WIDTH, GAME_WINDOW_HEIGHT };
