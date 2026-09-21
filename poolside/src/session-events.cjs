// What a session window's own events do to the session.
//
// Split out of windows.cjs: the module that decides *how* a session opens does not also need to hold the
// list of listeners, and this keeps both inside the size ceiling.
//
// Order matters in the close path. `close` still has a live window (so the bounds can be captured), while
// `closed` is after destruction — capturing geometry in the second one silently stores nothing.

/**
 * @param {object} deps
 * @param {import('electron').BrowserWindow} deps.window
 * @param {import('./types.cjs').SessionGroup} deps.group
 * @param {import('./session-fsm.cjs').SessionFsm} deps.fsm
 * @param {{dispose: () => void}} deps.supervision
 * @param {string} deps.accountName
 * @param {() => void} deps.beforeClose runs while the window still exists
 * @param {() => void} deps.onClosed runs after the session is gone
 * @param {import('./types.cjs').LogFn} deps.log
 */
function attachSessionEvents(deps) {
  const { window, group, fsm, supervision, accountName, beforeClose, onClosed, log } = deps;

  window.on('page-title-updated', event => {
    event.preventDefault();
    window.setTitle(`Poolside · ${accountName}`);
  });

  window.webContents.on('did-finish-load', () => {
    if (window.isDestroyed()) return;
    // A sign-in redirect can finish another main-frame load after the first one already moved the
    // session to ready. Treat that browser event as idempotent here; refused transitions elsewhere
    // still remain visible because they normally signal a real lifecycle bug.
    if (fsm.canSend('loaded')) fsm.send('loaded');
    log(`${accountName}: page loaded. Sign-in is managed in the game window.`);
  });

  window.webContents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
    // Code -3 (aborted) fires for ordinary in-app navigation and is not a failure.
    if (!mainFrame || code === -3) return;
    fsm.send('failed', `${description || 'load failed'} (code ${code})`);
    log(`${accountName}: page could not load (code ${code}). Reopen the session to retry.`, 'warning');
  });

  window.on('close', () => {
    beforeClose();
    fsm.send('close');
  });

  window.on('closed', () => {
    for (const child of group.children) if (!child.isDestroyed()) child.destroy();
    supervision.dispose();
    fsm.send('closed');
    fsm.dispose();
    onClosed();
    log(`${accountName}: window closed.`);
  });
}

module.exports = { attachSessionEvents };
