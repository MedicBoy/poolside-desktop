// The count-in, and the measurement that comes out of it.
//
// A pair has to be queued close together, and a person cannot click two windows on a clock. This gives one
// exact moment to aim at, names the window to click first, and then reads the two sessions' own screens to
// measure what the attempt actually achieved: how long after GO each screen moved away from the table it was
// sitting on, and how far apart those two moments were. Nothing here sends input to the game — the clicks are
// the operator's, and this is the instrument that says how close together they landed.
//
// The count-in itself is transient (it lasts seconds); what it measured goes into the match history, which is
// the durable part. `release-countdown.cjs` owns the rules and the wording; this owns the clock.

const countdown = require('./release-countdown.cjs');
const { recordReleaseStep } = require('./match-coordination.cjs');

/**
 * @param {{store: {current: any}, commit: (state: any, message: string|null) => any, log: (message: string, kind?: 'info'|'warning') => void, observe?: ((id: string) => any)|null, view?: (() => any)|null, now?: () => number, leadInMs?: number, watchMs?: number, tickMs?: number, setTimer?: (callback: () => void, delay: number) => any, clearTimer?: (timer: any) => void}} deps
 */
function createReleaseService({
  store,
  commit,
  log,
  observe = null,
  view = null,
  now = () => Date.now(),
  leadInMs = countdown.LEAD_IN_MS,
  watchMs = countdown.WATCH_MS,
  tickMs = 250,
  setTimer = (callback, delay) => setInterval(callback, delay),
  clearTimer = timer => clearInterval(timer)
}) {
  /** @type {any} */
  let current = null;
  /** @type {any} */
  let last = null;

  /** The state each session's screen was in when the count-in began, so a change is a change from that. */
  function screenState(id) {
    if (typeof observe !== 'function') return null;
    try {
      const screen = observe(id);
      return screen && typeof screen === 'object' && typeof screen.state === 'string' ? screen.state : null;
    } catch {
      return null;
    }
  }

  function match(matchId) {
    const found = store.current.matches.find(candidate => candidate.matchId === matchId);
    if (!found) throw new Error('That match is not in the local ledger.');
    if (found.state !== 'active') throw new Error('That match is no longer active.');
    return found;
  }

  /**
   * Start the count-in. It refuses until the barrier has released the match, because a count-in over sessions
   * that are not ready just counts down to two clicks that do nothing.
   * @param {{matchId: string, leadInMs?: number}} input
   */
  function arm({ matchId, leadInMs: asked = leadInMs }) {
    const found = match(matchId);
    if (current && !current.finished) throw new Error(`A count-in is already running for ${found.handle}. Stop it first.`);
    if (!found.readiness || found.readiness.verdict !== 'ready')
      throw new Error(
        `The count-in waits until both profiles are released. ${found.readiness ? found.readiness.reason : 'Release has not been requested yet.'}`
      );
    const order = countdown.clickOrder(found.participants.map(entry => entry.name));
    const startedAt = now();
    const goAt = startedAt + Math.max(1000, Number(asked) || countdown.LEAD_IN_MS);
    current = {
      matchId,
      handle: found.handle,
      order,
      startedAt,
      goAt,
      watchUntil: goAt + watchMs,
      before: new Map(found.participants.map(entry => [entry.id, screenState(entry.id)])),
      observed: [],
      announced: false,
      finished: false,
      cancelled: false,
      skewMs: null,
      skewLine: null,
      timer: null
    };
    log(`${found.handle}: count-in started. ${order.line} GO in ${Math.round((goAt - startedAt) / 1000)} seconds.`);
    current.timer = setTimer(() => {
      try {
        tick();
      } catch (error) {
        log(`The count-in could not continue: ${error instanceof Error ? error.message : String(error)}`, 'warning');
      }
    }, tickMs);
    if (current.timer && typeof current.timer.unref === 'function') current.timer.unref();
    return status(matchId);
  }

  /**
   * One tick: call GO once the count-in is over, then watch both screens for the moment each one moves. The
   * movement is the queue taking effect, and it is the only thing here that is measured rather than assumed.
   */
  function tick() {
    if (!current || current.finished) return;
    const at = now();
    if (!current.announced && at >= current.goAt) {
      current.announced = true;
      const detail = countdown.goLine(current.order);
      commit(
        recordReleaseStep(store.current, { matchId: current.matchId, event: 'count-in-go', detail, now: at }),
        `${current.handle}: ${detail}`
      );
    }
    if (!current.announced) return;
    for (const entry of match(current.matchId).participants) {
      if (current.observed.some(observed => observed.id === entry.id)) continue;
      const state = screenState(entry.id);
      if (state && state !== current.before.get(entry.id)) current.observed.push({ id: entry.id, name: entry.name, at });
    }
    if (current.observed.length >= 2 || at > current.watchUntil) finish(at);
  }

  /** Close the count-in and put what it measured into the match history, where it stays. */
  function finish(at) {
    const measured = countdown.measuredSkew(current.observed, current.goAt);
    current.finished = true;
    current.skewMs = measured ? measured.skewMs : null;
    current.skewLine = measured ? measured.line : null;
    if (current.timer) clearTimer(current.timer);
    current.timer = null;
    const detail = measured
      ? `Queued by hand: ${measured.line}`
      : `Queued by hand: only ${current.observed.length} of 2 screens moved within ${Math.round((current.watchUntil - current.goAt) / 1000)} seconds.`;
    commit(
      recordReleaseStep(store.current, { matchId: current.matchId, event: 'count-in-done', detail, now: at }),
      `${current.handle}: ${detail}`
    );
    last = current;
    current = null;
  }

  /** Stop a count-in that has not finished. Nothing was queued by it, and it says so. */
  function cancel({ matchId }) {
    if (!current || current.matchId !== matchId) throw new Error('No count-in is running for that match.');
    if (current.timer) clearTimer(current.timer);
    current.timer = null;
    current.finished = true;
    current.cancelled = true;
    log(`${current.handle}: count-in stopped ${current.announced ? 'after GO' : 'before GO'}.`);
    last = current;
    current = null;
  }

  /** What the card draws: the running count-in, or the last one for this match. @param {string|null} [matchId] */
  function status(matchId = null) {
    const release = current && (!matchId || current.matchId === matchId) ? current : last && last.matchId === matchId ? last : null;
    return countdown.viewFor(release, now());
  }

  function dispose() {
    if (current && current.timer) clearTimer(current.timer);
    current = null;
  }

  /** The dashboard's commands: start a count-in, stop one, and hand back the card's view either way. */
  function armCommand({ matchId, leadInMs: lead }) {
    const state = arm({ matchId, leadInMs: lead });
    return view ? { ...view(), release: state } : { release: state };
  }

  function cancelCommand({ matchId }) {
    cancel({ matchId });
    return view ? view() : {};
  }

  return { arm, cancel, tick, status, dispose, armCommand, cancelCommand };
}

module.exports = { createReleaseService };
