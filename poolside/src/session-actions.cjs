// Commands for an already-created account window.

const { verifyRoute } = require('./footprint.cjs');
const { arrangeSessions } = require('./window-arrange.cjs');

/** @param {any} deps */
function createSessionActions(deps) {
  const { getAccount, sessions, publish, log, gameUrl } = deps;

  async function checkRoute(id) {
    getAccount(id);
    const group = sessions.get(id);
    if (!group || group.window.isDestroyed()) throw new Error('Open this account window first.');
    const verified = await verifyRoute(group.session, group.footprint.route, gameUrl);
    group.footprint.verified = verified;
    publish();
    return verified;
  }

  function reloadAccount(id) {
    const account = getAccount(id);
    const group = sessions.get(id);
    if (!group || group.window.isDestroyed()) throw new Error('Open this account window before reloading it.');
    group.fsm.send('reload', 'manual page reload');
    log(`${account.name}: reloading the browser page on request.`);
    group.window.webContents.reload();
    publish();
  }

  function closeAccount(id) {
    const group = sessions.get(id);
    if (group && !group.window.isDestroyed()) group.window.close();
  }

  function closeAll() {
    for (const id of [...sessions.keys()]) closeAccount(id);
  }

  function arrange() {
    arrangeSessions({ log, sessions });
  }

  return { checkRoute, reloadAccount, closeAccount, closeAll, arrange };
}

module.exports = { createSessionActions };
