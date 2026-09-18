// Arranging the open session windows into a grid on the primary display's work area.
//
// Split out of windows.cjs to keep both inside the size ceiling, and because tiling is a layout concern
// rather than a session-lifecycle one: this module needs only the window list, not the FSM, the
// footprint or the profile store.
//
// The minimum size tracks the tile rather than being permanently lowered (that was defect D7 — arrange
// used to call setMinimumSize(420, 360) and never restore it). A tile smaller than the standard minimum
// gets a smaller floor for as long as that arrangement lasts, and the next single-window restore puts
// the standard minimum back from geometry.cjs.

const { screen } = require('electron');
const { tileGeometry, rectFor } = require('./layout.cjs');

const CRAMPED_WIDTH = 420;

/**
 * @param {{log: import('./types.cjs').LogFn, sessions: Map<string, import('./types.cjs').SessionGroup>}} deps
 */
function arrangeSessions(deps) {
  const { log, sessions } = deps;
  const windows = [...sessions.values()].map(group => group.window).filter(window => !window.isDestroyed());
  if (!windows.length) return;
  const area = screen.getPrimaryDisplay().workArea;
  const geometry = tileGeometry(windows.length, area);
  windows.forEach((window, index) => {
    window.setMinimumSize(geometry.minimumWidth, geometry.minimumHeight);
    window.setBounds(rectFor(index, geometry, area));
  });
  log(
    `Open game windows arranged on the main display (${geometry.cols}×${geometry.rows}, tile ${geometry.tileWidth}×${geometry.tileHeight}).`
  );
  if (geometry.cramped) {
    const limit = geometry.tileWidth < CRAMPED_WIDTH ? `${CRAMPED_WIDTH} wide` : '360 tall';
    log(`${windows.length} windows make each tile smaller than ${limit}; open fewer for a usable view.`, 'warning');
  }
}

module.exports = { arrangeSessions, CRAMPED_WIDTH };
