// Local screen observation scheduler. Production sessions start it automatically and the UI can stop
// or restart it. It only calls the existing inspector; it never emits page input, navigates, or reads
// page credentials.
//
// Every session being monitored is read, focused or not. This used to read only the focused window, which
// made a pair impossible to judge: clicking one window stopped the other being observed, so the two readings
// could never be fresh at the same time — the operator's report was "if i click on one the other one isnt
// getting read". What actually matters is whether a window is *rendering*, because a hidden or covered window
// would hand back its last painted frame as though it were current. So a window that is not on screen is
// skipped, and one that is visible is read whether or not it has focus.
const DEFAULT_INTERVAL_MS = 30000;
const MIN_INTERVAL_MS = 10000;

/**
 * @param {object} deps
 * @param {(id: string) => Promise<any>} deps.inspect
 * @param {(id: string) => boolean} deps.isOpen
 * @param {(id: string) => boolean} [deps.isSampleable] whether this window can be read at all; defaults to yes
 * @param {((id: string) => Promise<boolean>)|null} [deps.isRendering] whether the page is on screen right now
 * @param {() => void} deps.publish
 * @param {number} [deps.intervalMs] the default interval, floored at `MIN_INTERVAL_MS`
 * @param {(id: string) => number} [deps.intervalFor] a per-account interval, in milliseconds
 */
function createScreenMonitor({
  inspect,
  isOpen,
  isSampleable = () => true,
  isRendering = null,
  publish,
  intervalMs = DEFAULT_INTERVAL_MS,
  intervalFor
}) {
  /** @type {Map<string, {intervalMs: number, nextAt: number}>} */
  const active = new Map();
  /** @type {NodeJS.Timeout|null} */
  let timer = null;
  /** @type {number|null} */
  let timerMs = null;
  const interval = Math.max(MIN_INTERVAL_MS, Number(intervalMs) || DEFAULT_INTERVAL_MS);
  function resolveInterval(value) {
    return Math.max(MIN_INTERVAL_MS, Number(value) || interval);
  }
  async function tick() {
    const now = Date.now();
    for (const [id, entry] of [...active]) {
      if (!isOpen(id)) {
        active.delete(id);
        continue;
      }
      if (!isSampleable(id)) {
        // Not on screen: nothing to read. It becomes due again straight away, so it is read as soon as it is
        // back rather than after another full interval.
        entry.nextAt = 0;
        continue;
      }
      if (now < entry.nextAt) continue; // this account's own interval has not elapsed yet
      if (isRendering) {
        let rendering = true;
        try {
          rendering = await isRendering(id);
        } catch {
          rendering = true; // a page that cannot be asked is left to the inspector to judge
        }
        if (!rendering) {
          // Hidden or covered: reading it would report the last painted frame as though it were now, so wait
          // for it to come back rather than recording something that is not what the screen shows.
          entry.nextAt = 0;
          continue;
        }
      }
      entry.nextAt = now + entry.intervalMs;
      try {
        await inspect(id);
      } catch {
        /* the inspector publishes an explicit inspection-failed status on a capture failure */
      }
    }
    if (active.size) scheduleTimer();
    else stopTimer();
    publish();
  }
  // One timer at the shortest active interval; each account still observes its own interval above.
  function scheduleTimer() {
    const wanted = active.size ? Math.min(...[...active.values()].map(entry => entry.intervalMs)) : null;
    if (wanted === null) return stopTimer();
    if (timer && timerMs === wanted) return;
    stopTimer();
    timerMs = wanted;
    timer = setInterval(() => void tick(), wanted);
  }
  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
    timerMs = null;
  }
  /** @param {string} id @param {{intervalMs?: number}} [options] */
  function start(id, options = {}) {
    if (!isOpen(id)) throw new Error('Open this account window before starting live monitoring.');
    const ms = resolveInterval(options.intervalMs !== undefined ? options.intervalMs : intervalFor ? intervalFor(id) : undefined);
    active.set(id, { intervalMs: ms, nextAt: 0 });
    scheduleTimer();
    void tick();
    publish();
    return status(id);
  }
  function stop(id) {
    active.delete(id);
    if (active.size) scheduleTimer();
    else stopTimer();
    publish();
    return status(id);
  }
  function status(id) {
    const entry = active.get(id);
    return {
      active: Boolean(entry),
      intervalMs: entry ? entry.intervalMs : interval,
      sampleable: Boolean(entry) && isSampleable(id)
    };
  }
  function dispose() {
    active.clear();
    stopTimer();
  }
  return { start, stop, status, dispose, tick, interval };
}
module.exports = { createScreenMonitor, DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS };
