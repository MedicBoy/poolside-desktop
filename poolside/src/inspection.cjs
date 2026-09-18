// Screen inspection: locate the game surface, capture it, classify it, and report a state.
//
// Extracted from main.cjs so the composition root does not carry the capture pipeline, and so the
// failure text can be unit tested without an Electron window.

const { GAME_REGION_PROBE, REGION_REASONS } = require('./game-region.cjs');
const { officialPage } = require('./shop-recovery.cjs');
const { sessions } = require('./state.cjs');

const INSPECTION_TIMEOUT_MS = 30000;
const CAPTURE_WIDTH = 1200;

/**
 * Turn a failed region probe into a message that names what the page actually looked like.
 * @param {{reason?: string, candidates?: {kind: string, width: number, height: number, aspect: number, coverage: number}[]}|null|undefined} region
 * @returns {string}
 */
function describeRegionFailure(region) {
  const reason = (region && REGION_REASONS[region.reason]) || 'Could not isolate the game area.';
  const seen = ((region && region.candidates) || [])
    .slice(0, 3)
    .map(c => `${c.kind} ${c.width}×${c.height} (aspect ${c.aspect}, ${Math.round(c.coverage * 100)}% of view)`)
    .join('; ');
  return seen ? `${reason} Surfaces seen: ${seen}.` : reason;
}

/**
 * @param {{getAccount: Function, publish: Function, log: Function, screenReaders: {acquire: Function, release: Function}}} deps
 */
function createInspector(deps) {
  const { getAccount, publish, log, screenReaders } = deps;

  /**
   * Capture the game surface once and classify it. The result is a timestamped observation, never
   * proof of responsiveness.
   * @param {string} id
   */
  async function inspectGame(id) {
    const account = getAccount(id);
    const group = sessions.get(id);
    if (!group || group.window.isDestroyed()) throw new Error('Open this account window first.');
    // Per-account lock. This used to be a single module-level flag, so inspecting one account
    // blocked every other account (was defect D6).
    if (group.inspecting) throw new Error('A screen inspection is already running for this account. Try again shortly.');
    const wc = group.window.webContents;
    if (!officialPage(wc.getURL()) || wc.isLoadingMainFrame()) throw new Error('Wait for the official game page to finish loading.');
    const generation = group.observationGeneration;
    const stillCurrent = () => sessions.get(id) === group && !wc.isDestroyed() && group.observationGeneration === generation;
    group.inspecting = true;
    group.gameScreen = { state: 'inspecting' };
    publish();
    /** @type {NodeJS.Timeout|undefined} */
    let timeout;
    let expired = false;
    try {
      const work = async () => {
        const region = await wc.executeJavaScriptInIsolatedWorld(999, [{ code: GAME_REGION_PROBE }]);
        if (!region || !region.ok) throw new Error(describeRegionFailure(region));
        const zoom = wc.getZoomFactor();
        const rect = {
          x: Math.floor(region.rect.x * zoom),
          y: Math.floor(region.rect.y * zoom),
          width: Math.floor(region.rect.width * zoom),
          height: Math.floor(region.rect.height * zoom)
        };
        const picture = await wc.capturePage(rect);
        if (picture.isEmpty()) throw new Error('No game image was available.');
        const entry = await screenReaders.acquire();
        try {
          if (expired) throw new Error('Screen inspection timed out.');
          const reader = await entry.reader;
          return await reader.inspect(picture.resize({ width: CAPTURE_WIDTH }).toPNG());
        } finally {
          screenReaders.release(entry);
        }
      };
      const result = await Promise.race([
        work(),
        new Promise((_resolve, reject) => {
          timeout = setTimeout(() => {
            expired = true;
            reject(new Error('Screen inspection timed out.'));
          }, INSPECTION_TIMEOUT_MS);
        })
      ]);
      if (stillCurrent()) {
        group.gameScreen = result;
        const evidence = result.evidence.length ? result.evidence.join(', ') : 'no matching phrases';
        log(
          `${account.name}: screen observation: ${result.state} (confidence ${result.score}) from ${evidence}. This is a single image, not a responsiveness check.`
        );
      }
    } catch (error) {
      if (stillCurrent()) {
        group.gameScreen = { state: 'unknown', observedAt: new Date().toISOString() };
        publish();
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      group.inspecting = false;
    }
  }

  return { inspectGame };
}

module.exports = { createInspector, describeRegionFailure, INSPECTION_TIMEOUT_MS, CAPTURE_WIDTH };
