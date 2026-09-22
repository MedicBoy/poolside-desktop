// The readiness barrier: when a match may be released, and when release must be withdrawn.
//
// Split out of `match-service.cjs`, which had grown to the module ceiling and was carrying two jobs:
// running the coordinator's operations, and deciding whether the participants are actually up. This is
// the second job.
//
// The rules it applies, in order:
//   1. A match is created waiting (`preparing`) with a deadline; nothing is released before it.
//   2. Every participant must report releasable — its own window up, its session ready, and (when the
//      account is configured for a route) Chromium using that route. See `match-preflight.cjs`.
//   3. If a participant is not releasable by the deadline the match is `blocked`, naming who and which
//      check failed.
//   4. If a released participant stops being releasable, release is withdrawn immediately.
//
// The check runs only while some match is waiting, and every change is persisted and published, so the
// dashboard shows the barrier moving without a manual refresh.

const coordination = require('./match-coordination.cjs');
const { participantPreflight } = require('./match-preflight.cjs');

/**
 * @param {{store: {current: any}, persist: (state: any) => any, log: (message: string, kind?: 'info'|'warning') => void, publish: () => void, participant?: ((id: string) => any)|null, ready?: ((id: string) => boolean)|null, now?: () => number, monotonic?: () => number, readyDeadlineMs?: number, readyCheckMs?: number, setTimer?: (callback: () => void, delay: number) => any, clearTimer?: (timer: any) => void}} deps
 */
function createBarrier({
  store,
  persist,
  log,
  publish,
  participant = null,
  ready = null,
  now = () => Date.now(),
  monotonic = () => performance.now(),
  readyDeadlineMs = 120000,
  readyCheckMs = 1000,
  setTimer = (callback, delay) => setInterval(callback, delay),
  clearTimer = timer => clearInterval(timer)
}) {
  /** Monotonic marks for the matches waiting at the barrier. Memory only: a restart cannot measure skew. */
  const requested = new Map();
  /** @type {any} */
  let poll = null;

  /** What one participant reports about itself, as a verdict. */
  function verdictFor(id) {
    if (typeof participant === 'function') {
      try {
        const state = participant(id) || {};
        return participantPreflight(state, state.exit || null);
      } catch (error) {
        return { ok: false, detail: `The participant could not be inspected: ${error instanceof Error ? error.message : String(error)}` };
      }
    }
    // A caller that has only the session predicate still gets a verdict, so the barrier's rules can be
    // pinned without standing up a whole session. The application always wires the richer form.
    if (typeof ready === 'function') {
      const ok = Boolean(ready(id));
      return { ok, loaded: ok, route: { required: false, ok: true, detail: '' }, detail: ok ? 'Ready.' : 'The session is not ready.' };
    }
    return { ok: false, detail: 'This build cannot inspect a participant.' };
  }

  function participantReadiness(match) {
    return match.participants.map(entry => ({
      id: entry.id,
      name: entry.name,
      ...verdictFor(entry.id)
    }));
  }

  /** Keep a check running only while some match is actually waiting at the barrier. */
  function syncPoll() {
    const waiting = store.current.matches.some(
      match => match.state === 'active' && match.readiness && match.readiness.verdict === 'preparing'
    );
    if (waiting && !poll) {
      poll = setTimer(() => {
        try {
          advance();
        } catch (error) {
          log(`The readiness barrier could not be checked: ${error instanceof Error ? error.message : String(error)}`, 'warning');
        }
      }, readyCheckMs);
      if (poll && typeof poll.unref === 'function') poll.unref();
    }
    if (!waiting && poll) {
      clearTimer(poll);
      poll = null;
    }
  }

  /** Record that release was requested for a match, so the release can report how long it took. */
  function noteRequest(matchId) {
    requested.set(matchId, monotonic());
  }

  /** Advance every active match's barrier. Returns true when the ledger changed. */
  function advance() {
    const at = now();
    let next = store.current;
    let changed = false;
    /** @type {{handle: string, verdict: string, reason: string}[]} */
    const announced = [];
    for (const match of store.current.matches) {
      if (match.state !== 'active') continue;
      const readiness = match.readiness;
      const states = participantReadiness(match);
      const allReady = states.length === match.participants.length && states.every(entry => entry.ok === true);
      const waiting = states.filter(entry => entry.ok !== true).map(entry => `${entry.name} (${entry.detail})`);
      if (!readiness) {
        next = coordination.requestReadiness(next, { matchId: match.matchId, now: at, deadlineMs: readyDeadlineMs });
        noteRequest(match.matchId);
        changed = true;
        continue;
      }
      if (readiness.verdict === 'preparing' && allReady) {
        const mark = requested.get(match.matchId);
        // Say whether the participants share an exit. The addresses themselves stay on the cards: this
        // text is written to the ledger, and the application's rule is that addresses are not.
        const exits = states.map(entry => entry.exit && entry.exit.ip).filter(Boolean);
        const checked = states.filter(entry => entry.exit && entry.exit.checked === true).length;
        const shared =
          checked > 0 && exits.length === checked
            ? new Set(exits).size === 1
              ? ', leaving through the same exit'
              : ', leaving through different exits'
            : '';
        const reason = `${states.map(entry => entry.name).join(' and ')} are ready${shared}.`;
        next = coordination.settleReadiness(next, {
          matchId: match.matchId,
          verdict: 'ready',
          reason,
          releasedAt: at,
          skewMs: typeof mark === 'number' ? Math.max(0, monotonic() - mark) : null,
          now: at
        });
        requested.delete(match.matchId);
        announced.push({ handle: match.handle, verdict: 'ready', reason });
        changed = true;
        continue;
      }
      if (readiness.verdict === 'preparing' && Date.parse(readiness.deadlineAt) <= at) {
        const reason = `${waiting.join('; ')} did not become ready within ${Math.round(readyDeadlineMs / 1000)} seconds.`;
        next = coordination.settleReadiness(next, { matchId: match.matchId, verdict: 'blocked', reason, now: at });
        announced.push({ handle: match.handle, verdict: 'blocked', reason });
        changed = true;
        continue;
      }
      if (readiness.verdict === 'ready' && !allReady) {
        const reason = `Release was withdrawn: ${waiting.join('; ')}`;
        next = coordination.requestReadiness(next, { matchId: match.matchId, now: at, deadlineMs: readyDeadlineMs, reason });
        noteRequest(match.matchId);
        announced.push({ handle: match.handle, verdict: 'blocked', reason });
        changed = true;
      }
    }
    if (changed) {
      store.current = persist(next);
      for (const item of announced) log(`${item.handle}: ${item.reason}`, item.verdict === 'blocked' ? 'warning' : 'info');
      publish();
    }
    syncPoll();
    return changed;
  }

  /** Stop the barrier check. Used when the app is shutting down and by tests. */
  function dispose() {
    if (poll) clearTimer(poll);
    poll = null;
  }

  return { advance, syncPoll, noteRequest, dispose };
}

module.exports = { createBarrier };
