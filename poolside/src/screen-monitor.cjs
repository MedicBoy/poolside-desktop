// Local screen observation scheduler. Production sessions start it automatically and the UI can stop
// or restart it. It only calls the existing inspector; it never emits page input, navigates, or reads
// page credentials. A background account is paused until focused and a closed window is removed.
const DEFAULT_INTERVAL_MS = 30000;
const MIN_INTERVAL_MS = 10000;

/**
 * @param {object} deps
 * @param {(id: string) => Promise<any>} deps.inspect
 * @param {(id: string) => boolean} deps.isOpen
 * @param {(id: string) => boolean} [deps.isFocused] defaults to treating every open window as focused
 * @param {() => void} deps.publish
 * @param {number} [deps.intervalMs] the default interval, floored at `MIN_INTERVAL_MS`
 * @param {(id: string) => number} [deps.intervalFor] a per-account interval, in milliseconds
 */
function createScreenMonitor({ inspect, isOpen, isFocused = () => true, publish, intervalMs = DEFAULT_INTERVAL_MS, intervalFor }) {
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
      if (!isFocused(id)) continue; // paused while this window is not the focused one
      if (now < entry.nextAt) continue; // this account's own interval has not elapsed yet
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
      focused: Boolean(entry) && isFocused(id)
    };
  }
  function dispose() {
    active.clear();
    stopTimer();
  }
  return { start, stop, status, dispose, tick, interval };
}
module.exports = { createScreenMonitor, DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS };
