// The pairing checker: the wiring between the evidence rules and the running application.
//
// `pairing-evidence.cjs` decides what the two screens amount to and knows nothing about stores, clocks or
// sessions. This module watches the sessions, notices when a balance drops (which is what paying an entry
// fee looks like from outside), asks the rules for a verdict after release, records it on the match, and
// keeps checking for as long as a released match has no pairing. Same split as the readiness barrier.

const coordination = require('./match-coordination.cjs');
const evidence = require('./pairing-evidence.cjs');

/**
 * @param {{store: {current: any}, persist: (state: any) => any, publish: () => void, log: (message: string, kind?: 'info'|'warning') => void, observe?: ((id: string) => any)|null, now?: () => number, windowMs?: number, checkMs?: number, setTimer?: (callback: () => void, delay: number) => any, clearTimer?: (timer: any) => void}} deps
 */
function createPairingChecker({
  store,
  persist,
  publish,
  log,
  observe = null,
  now = () => Date.now(),
  windowMs = evidence.WINDOW_MS,
  checkMs = 5000,
  setTimer = (callback, delay) => setInterval(callback, delay),
  clearTimer = timer => clearInterval(timer)
}) {
  /** The last readings seen per account, so a drop can be noticed without keeping a balance history. */
  const lastReadings = new Map();
  /** The most recent paid entry per account: `{currency, amount, at, from, to}`. */
  const sightings = new Map();
  /** @type {any} */
  let poll = null;

  /** This account's latest screen observation, or null. A read that fails is a missing reading, not a crash. */
  function screenFor(id) {
    try {
      return typeof observe === 'function' ? observe(id) : null;
    } catch {
      return null;
    }
  }

  /**
   * Learn from the current readings: a fall in one of the drawn balances is what paying an entry looks like.
   * The rule that decides whether it counts — current, exact, and downwards — lives in `pairing-evidence.cjs`.
   * @param {string} id
   */
  function learn(id) {
    const screen = screenFor(id);
    const readings =
      screen && typeof screen === 'object' && screen.readings && typeof screen.readings === 'object' ? screen.readings : null;
    if (!readings) return;
    const previous = lastReadings.get(id) || null;
    lastReadings.set(id, readings);
    if (!previous) return;
    const paid = evidence.drop(previous, readings, now());
    if (paid) sightings.set(id, { ...paid, at: now() });
  }

  /** What each participant of this match has shown, in the shape the rules take. */
  function input(match, at) {
    return {
      participants: match.participants.map(entry => {
        learn(entry.id);
        return {
          id: entry.id,
          name: entry.name,
          observation: evidence.observation(screenFor(entry.id)),
          sighting: sightings.get(entry.id) || null
        };
      }),
      windowMs,
      now: at
    };
  }

  /**
   * Judge one match and record the verdict. A verdict that has not changed is not written again: the ledger
   * keeps the evidence, not a heartbeat.
   * @param {string} matchId
   * @param {{force?: boolean}} [options]
   */
  function check(matchId, { force = false } = {}) {
    const match = store.current.matches.find(candidate => candidate.matchId === matchId);
    if (!match) throw new Error('That match is not in the local ledger.');
    if (match.state !== 'active') throw new Error('That match is no longer active.');
    const at = now();
    const verdict = evidence.evaluate(input(match, at));
    const recorded = match.pairing;
    const changed = !recorded || recorded.verdict !== verdict.verdict || recorded.reason !== verdict.reason;
    if (changed) {
      store.current = persist(coordination.recordPairing(store.current, { matchId, pairing: verdict, now: at }));
      log(`${match.handle}: pairing evidence — ${verdict.label}: ${verdict.reason}`, verdict.verdict === 'mismatch' ? 'warning' : 'info');
      publish();
    } else if (force) {
      log(`${match.handle}: pairing evidence re-checked — ${verdict.label}: ${verdict.reason}`);
    }
    return verdict;
  }

  /**
   * A pairing can only be judged after release: before that there is nothing on either screen to read. Every
   * released match without a pairing is judged again, which is also what makes the verdict improve by itself
   * once the operator looks at each window.
   */
  function checkReleased() {
    for (const match of store.current.matches) {
      if (match.state !== 'active') continue;
      if (!match.readiness || match.readiness.verdict !== 'ready') continue;
      check(match.matchId);
    }
    syncPoll();
  }

  /**
   * Keep checking while any match in progress has no pairing.
   *
   * The clock has to be watched from the moment a match starts, not from the moment it is released: release
   * happens on the barrier's own poll, so waiting for it would leave the first judgement to whatever the
   * operator does next.
   */
  function syncPoll() {
    const watching = store.current.matches.some(
      match => match.state === 'active' && (!match.pairing || match.pairing.verdict !== 'paired')
    );
    if (watching && !poll) {
      poll = setTimer(() => {
        try {
          checkReleased();
        } catch (error) {
          log(`The pairing evidence could not be checked: ${error instanceof Error ? error.message : String(error)}`, 'warning');
        }
      }, checkMs);
      if (poll && typeof poll.unref === 'function') poll.unref();
    }
    if (!watching && poll) {
      clearTimer(poll);
      poll = null;
    }
  }

  /** Stop the check. Used when the app is shutting down and by tests. */
  function dispose() {
    if (poll) clearTimer(poll);
    poll = null;
  }

  return { check, checkReleased, syncPoll, dispose, sightings };
}

module.exports = { createPairingChecker };
