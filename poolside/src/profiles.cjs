// Saved browser profiles: restore an account's session on open and keep it saved afterwards.
//
// One store per account. Writes are serialised through a promise queue and debounced, because the
// cookie 'changed' event fires in bursts during login.

const { app, safeStorage } = require('electron');
const savedSessions = require('./saved-session.cjs');

const SAVE_DEBOUNCE_MS = 500;

/**
 * @param {{log: import('./types.cjs').LogFn}} deps
 */
function createProfileStore(deps) {
  const { log } = deps;
  /** @type {Map<string, {queue: Promise<unknown>, timer: NodeJS.Timeout|undefined, ready: Promise<void>, flush: () => Promise<unknown>}>} */
  const stores = new Map();

  /**
   * Restore and start persisting one account's session.
   * @param {import('./types.cjs').Account} account
   * @param {import('electron').Session} isolated
   * @returns {Promise<void>}
   */
  function prepare(account, isolated) {
    const previous = stores.get(account.id);
    if (previous) return previous.ready;
    const root = app.getPath('userData');
    const store = {
      queue: /** @type {Promise<unknown>} */ (Promise.resolve()),
      timer: /** @type {NodeJS.Timeout|undefined} */ (undefined),
      ready: /** @type {Promise<void>} */ (Promise.resolve()),
      flush: /** @type {() => Promise<unknown>} */ (() => Promise.resolve())
    };
    stores.set(account.id, store);

    store.flush = () => {
      clearTimeout(store.timer);
      const save = () => savedSessions.saveSession(root, account, isolated, safeStorage);
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

  /** Flush every profile. Used on quit. */
  function flushAll() {
    return Promise.allSettled(
      [...stores.values()].map(async store => {
        await store.ready;
        await store.flush();
      })
    );
  }

  function hasProfiles() {
    return stores.size > 0;
  }

  function count() {
    return stores.size;
  }

  return { prepare, flushAll, hasProfiles, count };
}

module.exports = { createProfileStore, SAVE_DEBOUNCE_MS };
