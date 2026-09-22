// The balances around a match, kept for the one write that records what happened.
//
// The *before* reading has to be taken before the match is released — that is the last moment the operator's
// screens are on the table screen, before any entry could be paid — and the *after* reading has to be taken at
// the moment the match settles. Between those two moments the numbers live here, in memory, because they only
// mean anything for a match this process is holding: a restart interrupts the match instead.

const evidence = require('./outcome-evidence.cjs');

/**
 * @param {{store: {current: any}, observe?: ((id: string) => any)|null, now?: () => number}} deps
 */
function createOutcomeRecorder({ store, observe = null, now = () => Date.now() }) {
  /** @type {Map<string, {id: string, name: string, snapshot: any}[]>} */
  const before = new Map();

  /** One session's balances right now, as data: what was read, how confidently, and when. */
  function balanceSnapshot(id) {
    try {
      const screen = typeof observe === 'function' ? observe(id) : null;
      return evidence.snapshot(screen && screen.readings ? screen.readings : null, now());
    } catch {
      return evidence.snapshot(null, now());
    }
  }

  /** Take this match's before-reading. Called when the match is created, and again while it is still waiting. */
  function remember(match) {
    before.set(
      match.matchId,
      match.participants.map(entry => ({ id: entry.id, name: entry.name, snapshot: balanceSnapshot(entry.id) }))
    );
  }

  /** Refresh the before-reading of every match that has not been released yet. */
  function rememberWaiting() {
    for (const match of store.current.matches)
      if (match.state === 'active' && (!match.readiness || match.readiness.verdict !== 'ready')) remember(match);
  }

  /** What the balances did around this match, ready for the ledger. Consumed once. */
  function take(match) {
    const remembered = before.get(match.matchId) || null;
    before.delete(match.matchId);
    return evidence.outcome({
      participants: match.participants.map(entry => ({
        name: entry.name,
        before: remembered ? (remembered.find(item => item.id === entry.id) || {}).snapshot || null : null,
        after: balanceSnapshot(entry.id)
      }))
    });
  }

  return { remember, rememberWaiting, take };
}

module.exports = { createOutcomeRecorder };
