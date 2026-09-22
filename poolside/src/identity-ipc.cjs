// The dashboard's way to ask each open session what it reports about itself.
//
// Reading is done through the session's own window, so the answer is what that session sees. A window that has
// gone between the request and the read is reported as unreadable rather than failing the comparison, and a
// session that is not open is not in the answer at all — comparing itself with a closed profile would be a
// comparison of nothing.

const identityReadback = require('./identity-readback.cjs');
const { messageOf } = require('./errors.cjs');

/**
 * @param {{handle: (name: string, fn: (input?: any) => any) => void, sessions: Map<string, any>, accounts: () => any[]}} deps
 */
function registerIdentityIpc({ handle, sessions, accounts }) {
  handle('identity:readback', async () => {
    const open = accounts().filter(account => {
      const group = sessions.get(account.id);
      const window = group && group.window;
      return Boolean(window && typeof window.isDestroyed === 'function' && !window.isDestroyed());
    });
    const read = await Promise.all(
      open.map(async account => {
        const group = sessions.get(account.id);
        try {
          return { id: account.id, name: account.name, read: await group.window.webContents.executeJavaScript(identityReadback.SCRIPT) };
        } catch (error) {
          // A page that will not answer is reported as unreadable for that one session, with the reason available
          // in the activity feed, rather than taking the whole comparison down with it.
          return { id: account.id, name: account.name, read: null, error: messageOf(error) };
        }
      })
    );
    return identityReadback.compare(read);
  });
}

module.exports = { registerIdentityIpc };
