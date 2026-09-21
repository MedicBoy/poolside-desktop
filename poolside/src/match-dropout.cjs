// Dropout: a participant whose session is gone.
//
// A match in progress can lose a participant in a way the account list cannot see — the window is closed, a
// renderer dies, a profile is repaired — and the match then sits in progress with one side unable to play.
// The barrier already reports that participant as not releasable, and that is the right answer for release.
// This module adds the other half: after a grace period with no session at all, the match is cancelled as a
// dropout, naming who, so the ledger does not hold a match that cannot happen and the run counts it as an
// attempt that came to nothing.
//
// The grace exists because a session can blink: a reload or a repair removes and rebuilds the window, and a
// match cancelled on the first missing sample would be cancelled by the app's own maintenance. Nothing here
// acts on a participant that is *open but not ready* — that is the barrier's business, not a dropout.

/**
 * @param {{store: {current: any}, participant?: ((id: string) => {open?: boolean}|null)|null, cancel: (matchId: string, reason: string) => void, log: (message: string, kind?: 'info'|'warning') => void, now?: () => number, graceMs?: number, checkMs?: number, setTimer?: (callback: () => void, delay: number) => any, clearTimer?: (timer: any) => void}} deps
 */
function createDropoutWatcher({
  store,
  participant = null,
  cancel,
  log,
  now = () => Date.now(),
  graceMs = 15000,
  checkMs = 5000,
  setTimer = (callback, delay) => setInterval(callback, delay),
  clearTimer = timer => clearInterval(timer)
}) {
  /** When each participant was first seen without a session. Cleared the moment one is seen again. */
  const missingSince = new Map();
  /** @type {any} */
  let poll = null;

  function open(id) {
    if (typeof participant !== 'function') return null;
    try {
      const state = participant(id);
      return state ? state.open === true : false;
    } catch {
      return false;
    }
  }

  /**
   * Cancel every match whose participant has had no session for longer than the grace period. The `cancel`
   * callback is the service's own cancel: it records the reason, enforces the run's plan against the match
   * that just ended, and publishes. What comes back here is what this call cancelled, for the caller's reply.
   */
  function watch() {
    const at = now();
    /** @type {{matchId: string, handle: string, reason: string}[]} */
    const cancelled = [];
    if (typeof participant !== 'function') {
      syncPoll();
      return cancelled;
    }
    for (const match of store.current.matches) {
      if (match.state !== 'active') continue;
      const states = match.participants.map(entry => ({ entry, here: open(entry.id) === true }));
      // A participant that came back clears its own clock: a blink is not a dropout.
      for (const item of states.filter(candidate => candidate.here)) missingSince.delete(item.entry.id);
      for (const item of states.filter(candidate => !candidate.here))
        if (!missingSince.has(item.entry.id)) missingSince.set(item.entry.id, at);
      const longest = states
        .filter(candidate => !candidate.here)
        .map(candidate => ({ entry: candidate.entry, since: missingSince.get(candidate.entry.id) }))
        .filter(item => Number.isFinite(item.since) && at - item.since >= graceMs)
        .sort((left, right) => left.since - right.since)[0];
      if (!longest) continue;
      const seconds = Math.round((at - longest.since) / 1000);
      const reason = `${longest.entry.name}'s session has been closed for ${seconds} seconds, so ${match.handle} was cancelled as a dropout.`;
      missingSince.delete(longest.entry.id);
      cancel(match.matchId, reason);
      cancelled.push({ matchId: match.matchId, handle: match.handle, reason });
    }
    syncPoll();
    return cancelled;
  }

  /** Watch while a match is in progress. Nothing to watch means no timer. */
  function syncPoll() {
    const watching = typeof participant === 'function' && store.current.matches.some(match => match.state === 'active');
    if (watching && !poll) {
      poll = setTimer(() => {
        try {
          watch();
        } catch (error) {
          log(`The dropout check could not run: ${error instanceof Error ? error.message : String(error)}`, 'warning');
        }
      }, checkMs);
      if (poll && typeof poll.unref === 'function') poll.unref();
    }
    if (!watching && poll) {
      clearTimer(poll);
      poll = null;
    }
  }

  function dispose() {
    if (poll) clearTimer(poll);
    poll = null;
    missingSince.clear();
  }

  return { watch, syncPoll, dispose, missingSince };
}

module.exports = { createDropoutWatcher };
