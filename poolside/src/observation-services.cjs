// Wiring for the two observation services the composition root needs: the inspector and the screen monitor.
const { createInspector } = require('./inspection.cjs');
const { createScreenMonitor } = require('./screen-monitor.cjs');
const { resolveRecovery } = require('./recovery-settings.cjs');

function createObservationServices({ getAccount, publish, log, screenReaders, captureLab, deviceScaleFactor, sessions }) {
  const inspector = createInspector({ getAccount, publish, log, screenReaders, captureLab, deviceScaleFactor });
  const group = id => {
    const session = sessions.get(id);
    return session && !session.window.isDestroyed() ? session : null;
  };
  const monitor = createScreenMonitor({
    inspect: id => inspector.inspectGame(id),
    isOpen: id => Boolean(group(id)),
    // Readable while it is on screen, focused or not: the game's own window is the thing being read, and a
    // pair of accounts can only be judged if both are read.
    //
    // `window.isVisible()` is deliberately not used here. Measured in the self-test on this application's own
    // session windows: it reports false for a window that Chromium is rendering and whose page reports
    // itself visible, so gating on it would skip a perfectly readable window — the same defect as reading only
    // the focused one, one layer down. A minimised window is the one thing knowable without asking the page.
    isSampleable: id => {
      const session = group(id);
      return Boolean(session && !session.window.isMinimized());
    },
    // Chromium's own opinion of whether this page is being rendered. A minimised or fully covered window
    // reports 'hidden', and reading it would record its last painted frame as if it were current.
    isRendering: async id => {
      const session = group(id);
      if (!session) return false;
      const contents = session.window.webContents;
      if (contents.isDestroyed() || contents.isLoadingMainFrame()) return true;
      const state = await contents.executeJavaScriptInIsolatedWorld(999, [{ code: 'document.visibilityState' }]);
      return state !== 'hidden';
    },
    // Each account's own setting; the inspector never runs faster than the monitor's floor.
    intervalFor: id => resolveRecovery(getAccount(id)).monitorIntervalSeconds * 1000,
    publish
  });
  return { inspector, monitor };
}
module.exports = { createObservationServices };
