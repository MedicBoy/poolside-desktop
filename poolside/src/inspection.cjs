// Screen inspection: locate the game surface, capture it, classify it, and report a state.
//
// Extracted from main.cjs so the composition root does not carry the capture pipeline, and so the
// failure text can be unit tested without an Electron window.

const { GAME_REGION_PROBE, REGION_REASONS } = require('./game-region.cjs');
const { toCaptureRect, checkCapture, describeFrame } = require('./vision-frame.cjs');
const { officialPage } = require('./shop-recovery.cjs');
const { sessions } = require('./state.cjs');
const { append } = require('./screen-history.cjs');
const { observe: observeAttention } = require('./screen-attention.cjs');

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
 * Set aside one frame the first time a state is recognised, so the corpus grows with the reader instead of
 * only when someone remembers to label a capture.
 *
 * The frame is stored as *evidence*, under the state the reader itself reported, and never as an asserted
 * label. The evidence cohort is excluded from the benchmark, so a state nobody has reviewed cannot quietly
 * raise the accuracy figure the benchmark reports. It waits in Capture lab as unreviewed until it is
 * confirmed or discarded.
 * @param {any} captureLab
 * @param {any} input
 */
function recordNewState(captureLab, { png, result, frame, timing }) {
  if (!captureLab || typeof captureLab.record !== 'function') return null;
  const state = result && result.state;
  // `unknown` is a supported capture label for a person to assert, but it is not a state the reader
  // recognised, so it is never what a frame is filed under automatically.
  if (typeof state !== 'string' || state === 'unknown' || !captureLab.states.includes(state)) return null;
  if (captureLab.list().some(sample => sample.observedState === state || sample.expectedState === state)) return null;
  try {
    return captureLab.record({ png, expectedState: state, observed: result, frame, cohort: 'evidence', timing }).id;
  } catch {
    // A state that cannot be recorded is not a reason to lose the observation that found it.
    return null;
  }
}

/**
 * @param {{getAccount: Function, publish: Function, log: Function, screenReaders: {acquire: Function, release: Function}, captureLab?: {record: Function}, deviceScaleFactor?: () => number, now?: () => number}} deps
 */
function createInspector(deps) {
  const { getAccount, publish, log, screenReaders, captureLab, deviceScaleFactor, now = () => performance.now() } = deps;

  /**
   * Capture the game surface once and classify it. The result is a timestamped observation, never
   * proof of responsiveness.
   * @param {string} id
   * @param {{expectedState: string, cohort?: string}|null} [capture]
   */
  async function inspectGame(id, capture = null) {
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
    const startedAt = now();
    try {
      const work = async () => {
        // The shop is page content, not the game's canvas/iframe. A user who explicitly labels a shop sample
        // can capture the visible page; normal Inspect game remains restricted to the game region.
        let picture;
        let frame;
        let captureNotes = [];
        const surfaceStartedAt = now();
        if (capture?.expectedState === 'shop') {
          picture = await wc.capturePage();
          if (picture.isEmpty()) throw new Error('No shop image was available.');
          const size = picture.getSize();
          frame = { width: size.width, height: size.height };
        } else {
          const region = await wc.executeJavaScriptInIsolatedWorld(999, [{ code: GAME_REGION_PROBE }]);
          if (!region || !region.ok) throw new Error(describeRegionFailure(region));
          const zoom = wc.getZoomFactor();
          const requested = toCaptureRect(region.rect, zoom);
          if (!requested.ok) throw new Error(requested.message);
          picture = await wc.capturePage(requested.rect);
          if (picture.isEmpty()) throw new Error('No game image was available.');
          const size = picture.getSize();
          const captured = checkCapture({
            pageRect: region.rect,
            zoom,
            imageWidth: size.width,
            imageHeight: size.height,
            deviceScaleFactor: typeof deviceScaleFactor === 'function' ? deviceScaleFactor() : undefined
          });
          if (!captured.ok) throw new Error(captured.message);
          frame = captured.frame;
          captureNotes = captured.notes;
        }
        const entry = await screenReaders.acquire();
        try {
          if (expired) throw new Error('Screen inspection timed out.');
          if (captureNotes.length) {
            const described = frame && frame.pageRect ? describeFrame(frame) : 'full visible page';
            log(`${account.name}: capture note — ${described}: ${captureNotes.join('; ')}.`, 'warning');
          }
          const reader = await entry.reader;
          const png = picture.resize({ width: CAPTURE_WIDTH }).toPNG();
          const surfaceMs = now() - surfaceStartedAt;
          const recognitionStartedAt = now();
          const result = await reader.inspect(png);
          const timing = { surfaceMs, recognitionMs: now() - recognitionStartedAt, totalMs: now() - startedAt };
          if (!capture) return { ...result, sampleId: recordNewState(captureLab, { png, result, frame, timing }) };
          if (!captureLab) throw new Error('The local capture lab is unavailable.');
          const sample = captureLab.record({
            png,
            expectedState: capture.expectedState,
            observed: result,
            frame,
            cohort: capture.cohort,
            timing
          });
          return { ...result, sampleId: sample.id };
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
        group.visibleReadings = result.readings || {};
        group.screenHistory = append(group.screenHistory, result);
        group.screenAttention = observeAttention(group.screenAttention, result);
        const evidence = result.evidence.length ? result.evidence.join(', ') : 'no matching phrases';
        const saved = result.sampleId ? ' A local capture sample was saved for evaluation.' : '';
        log(
          `${account.name}: screen observation: ${result.state} (confidence ${result.score}) from ${evidence}. This is a single image, not a responsiveness check.${saved}`
        );
      }
      return result;
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

module.exports = { createInspector, describeRegionFailure, recordNewState, INSPECTION_TIMEOUT_MS, CAPTURE_WIDTH };
