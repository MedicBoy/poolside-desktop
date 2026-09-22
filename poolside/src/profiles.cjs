// Saved browser profiles: restore an account's session on open and keep it saved afterwards.
//
// One store per account, registered in state.cjs (`sessionStores`) so there is a single place that
// declares where session state lives. Writes are serialised through a promise queue and debounced,
// because the cookie 'changed' event fires in bursts during login.
//
// The store outlives its window deliberately: the debounce means a save may still be pending when
// the window closes, and before-quit flushes every store.

const { app, safeStorage } = require('electron');
const savedSessions = require('./saved-session.cjs');
const { sessionStores, sessions } = require('./state.cjs');

const SAVE_DEBOUNCE_MS = 500;

/**
 * @param {{log: import('./types.cjs').LogFn, publish?: () => void}} deps
 */
function createProfileStore(deps) {
  const { log, publish = () => {} } = deps;

  /**
   * Restore and start persisting one account's session.
   * @param {import('./types.cjs').Account} account
   * @param {import('electron').Session} isolated
   * @returns {Promise<void>}
   */
  function prepare(account, isolated) {
    const previous = sessionStores.get(account.id);
    if (previous) return previous.ready;
    const root = app.getPath('userData');
    /** @type {import('./types.cjs').ProfileStore} */
    const store = {
      queue: Promise.resolve(),
      timer: undefined,
      ready: Promise.resolve(),
      flush: () => Promise.resolve()
    };
    sessionStores.set(account.id, store);

    store.flush = () => {
      clearTimeout(store.timer);
      const save = async () => {
        await savedSessions.saveSession(root, account, isolated, safeStorage);
        const group = sessions.get(account.id);
        if (group) {
          group.lastPersistedAt = new Date().toISOString();
          publish();
        }
      };
      store.queue = store.queue.then(save, save);
      return store.queue;
    };

    store.ready = (async () => {
      await savedSessions.restoreSession(root, account, isolated, safeStorage);
      await store.flush();
      isolated.cookies.on('changed', () => {
        clearTimeout(store.timer);
        store.timer = setTimeout(
          () => store.flush().catch(() => log(`${account.name}: session could not be saved.`, 'warning')),
          SAVE_DEBOUNCE_MS
        );
      });
    })();

    return store.ready;
  }

  /** Flush every saved session. Used on quit. */
  function flushAll() {
    return Promise.allSettled(
      [...sessionStores.values()].map(async store => {
        await store.ready;
        await store.flush();
      })
    );
  }

  /** Persist one account as soon as its browser window closes. The process-wide quit flush remains
   * the final barrier, but this narrows the window in which an interrupted update could lose a newly
   * issued session cookie. */
  async function flushAccount(id) {
    const store = sessionStores.get(id);
    if (!store) return;
    await store.ready;
    await store.flush();
  }

  function hasProfiles() {
    return sessionStores.size > 0;
  }

  function count() {
    return sessionStores.size;
  }

  return { prepare, flushAccount, flushAll, hasProfiles, count };
}

module.exports = { createProfileStore, SAVE_DEBOUNCE_MS };
