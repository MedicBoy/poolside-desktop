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
    isFocused: id => {
      const session = group(id);
      return Boolean(session && session.window.isFocused());
    },
    // Each account's own setting; the inspector never runs faster than the monitor's floor.
    intervalFor: id => resolveRecovery(getAccount(id)).monitorIntervalSeconds * 1000,
    publish
  });
  return { inspector, monitor };
}
module.exports = { createObservationServices };
