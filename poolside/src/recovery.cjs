// Per-window recovery supervision: shop detection with automatic return, and post-load repaints.
//
// Extracted from main.cjs. The original stall/freeze workarounds live here; they remain candidate
// mitigations rather than a verified fix (see ../video-review.md).

const { SHOP_PROBE, ShopReturnGate, officialPage } = require('./shop-recovery.cjs');
const { resolveRecovery } = require('./recovery-settings.cjs');

const POLL_INTERVAL_MS = 1000;
const SHOP_SETTLE_MS = 5000;
const REPAINT_DELAYS_MS = [0, 1000, 3000, 8000];
/**
 * How long one shop probe may take before it is abandoned. The poll body awaits the page, so a renderer
 * that never answers would otherwise hold `busy` forever and the automatic return would stop happening
 * with no failure anywhere: exactly the kind of silent stall this module exists to remove.
 */
const PROBE_TIMEOUT_MS = 4000;

/** Resolve with the promise, or reject once the deadline passes. */
function withDeadline(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the shop probe did not answer')), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Attach recovery behaviour to one open game window.
 * @param {string} id
 * @param {import('./types.cjs').SessionGroup} group
 * @param {{log: import('./types.cjs').LogFn, publish: Function, getAccount: Function, returnToGame: (id: string, focus?: boolean) => Promise<void>}} deps
 */
function attachRecovery(id, group, deps) {
  const { log, publish, getAccount, returnToGame } = deps;
  const wc = group.window.webContents;
  const preferences = resolveRecovery(getAccount(id));
  const gate = new ShopReturnGate(preferences.shopReturnDelaySeconds * 1000);
  group.shopGate = gate;
  let busy = false;
  let generation = 0;
  /** @type {Set<NodeJS.Timeout>} */
  const repaintTimers = new Set();
  const clearRepaints = () => {
    for (const timer of repaintTimers) clearTimeout(timer);
    repaintTimers.clear();
  };

  wc.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame) {
      generation++;
      group.observationGeneration = generation;
      group.gameScreen = null;
      gate.reset();
      publish();
      if (!inPlace) clearRepaints();
    }
  });

  wc.on('did-finish-load', () => {
    clearRepaints();
    if (!preferences.repaintMitigation || !officialPage(wc.getURL())) return;
    for (const delay of REPAINT_DELAYS_MS) {
      const timer = setTimeout(() => {
        repaintTimers.delete(timer);
        if (!wc.isDestroyed()) wc.invalidate();
      }, delay);
      repaintTimers.add(timer);
    }
  });

  group.window.on('focus', () => {
    if (!wc.isDestroyed()) wc.invalidate();
  });

  const poll = setInterval(async () => {
    if (busy || wc.isDestroyed() || gate.used) return;
    const url = wc.getURL();
    if (!officialPage(url) || wc.isLoadingMainFrame()) {
      gate.reset();
      return;
    }
    busy = true;
    const observedGeneration = generation;
    try {
      const shop = await withDeadline(wc.executeJavaScriptInIsolatedWorld(999, [{ code: SHOP_PROBE }]), PROBE_TIMEOUT_MS);
      if (wc.isDestroyed() || observedGeneration !== generation || url !== wc.getURL()) return;
      if (gate.observe(url, shop === true, Date.now())) {
        log(`${getAccount(id).name}: shop remained visible for the configured delay; returning to the game automatically.`);
        await returnToGame(id, false);
      }
    } catch {
      gate.reset();
    } finally {
      busy = false;
    }
  }, POLL_INTERVAL_MS);

  group.window.once('closed', () => {
    clearInterval(poll);
    clearRepaints();
  });
}

module.exports = { attachRecovery, POLL_INTERVAL_MS, SHOP_SETTLE_MS, REPAINT_DELAYS_MS, PROBE_TIMEOUT_MS };
