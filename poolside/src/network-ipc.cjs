const { createSessionIpReader } = require('./session-ip.cjs');
const { resolveProxyRoute } = require('./proxy.cjs');
const { workspace } = require('./state.cjs');
const { messageOf } = require('./errors.cjs');
const { windowTitleFor } = require('./window-title.cjs');

/** @param {{sessions: Map<string, any>, getAccount: (id: string) => any, publish: () => void, log: (message: string, level?: 'info'|'warning') => void}} deps */
function createAccountIpCheck({ sessions, getAccount, publish, log }) {
  return async function checkAccountIP(id) {
    const account = getAccount(id);
    const group = sessions.get(id);
    if (!group) throw new Error('Open this account window before checking its IP.');
    if (group.network && group.network.status === 'checking') return;
    group.network = { status: 'checking' };
    publish();
    try {
      // The read has to happen through the session's own route, with the credentials for that route: a bare
      // fetch cannot answer an authenticated proxy's challenge, so a routed session would read nothing.
      const route = resolveProxyRoute(account, { ...workspace.data.settings, routePresets: workspace.data.routePresets || [] });
      const result = await createSessionIpReader({
        session: group.session,
        credentials: route.credentials || null,
        expectedTarget: route.expectedTarget || null
      })();
      if (sessions.get(id) !== group) return;
      group.network = { status: 'checked', ...result };
      // The window states which address this session leaves as, so it can be verified at a glance.
      if (group.window && typeof group.window.isDestroyed === 'function' && !group.window.isDestroyed())
        group.window.setTitle(windowTitleFor(account.name, result.ip));
      log(`${account.name}: public IP checked using this session. This does not verify game routing or location.`);
    } catch (error) {
      if (sessions.get(id) !== group) return;
      group.network = { status: 'error' };
      if (group.window && typeof group.window.isDestroyed === 'function' && !group.window.isDestroyed())
        group.window.setTitle(windowTitleFor(account.name, null));
      log(`${account.name}: ${messageOf(error)}`, 'warning');
      throw error;
    }
  };
}

module.exports = { createAccountIpCheck };
