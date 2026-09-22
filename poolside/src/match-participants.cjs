// Bringing a match's participants up, and reading the address they leave through.
//
// Split from `match-service.cjs`, which had reached the module ceiling: coordinating a match and loading the
// sessions it needs are two jobs. Opening is idempotent — the session manager focuses a window that is
// already open — and one participant failing to load never stops the other. The failure is returned and
// logged rather than swallowed, because a match whose participants are not loaded is not one the operator
// can play.

const { routeVerdict } = require('./match-preflight.cjs');

/**
 * @param {{store: {current: any}, publish: () => void, log: (message: string, kind?: 'info'|'warning') => void, openSession?: ((id: string) => Promise<any>)|null, participant?: ((id: string) => any)|null, probeExit?: ((id: string) => Promise<any>)|null}} deps
 */
function createParticipantLoader({ store, publish, log, openSession = null, participant = null, probeExit = null }) {
  /** The match, or a refusal. Both operations below are about a match that is still in progress. */
  function liveMatch(matchId) {
    const match = store.current.matches.find(candidate => candidate.matchId === matchId);
    if (!match) throw new Error('That match is not in the local ledger.');
    if (match.state !== 'active') throw new Error('That match is no longer active.');
    return match;
  }

  /**
   * Bring up every participant's own browser session, and report per participant what happened.
   * @param {string} matchId
   */
  async function open(matchId) {
    const match = liveMatch(matchId);
    if (typeof openSession !== 'function') {
      log(`${match.handle}: this build cannot open participant sessions, so nothing was loaded.`, 'warning');
      return [];
    }
    const results = await Promise.all(
      match.participants.map(async entry => {
        try {
          await openSession(entry.id);
          return { id: entry.id, name: entry.name, opened: true, error: null };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log(`${entry.name}: the session could not be opened for ${match.handle} (${message}).`, 'warning');
          return { id: entry.id, name: entry.name, opened: false, error: message };
        }
      })
    );
    publish();
    if (results.every(result => result.opened)) log(`${match.handle}: both sessions are loading.`);
    return results;
  }

  /**
   * Read the address each participant leaves through — but only where a route is configured, because that is
   * the only case where the address proves something (that the route is doing what it says). With no route
   * there is nothing to prove and nothing is requested, which is also what keeps the offline checks offline.
   * A failure here is not fatal on its own: the barrier sees no exit and decides.
   * @param {string} matchId
   */
  async function proveExits(matchId) {
    if (typeof probeExit !== 'function' || typeof participant !== 'function') return;
    const match = store.current.matches.find(candidate => candidate.matchId === matchId);
    if (!match || match.state !== 'active') return;
    await Promise.all(
      match.participants.map(async entry => {
        try {
          const state = participant(entry.id);
          if (!routeVerdict(state && state.footprint).required) return;
          await probeExit(entry.id);
        } catch (error) {
          log(`${entry.name}: the exit address could not be read (${error instanceof Error ? error.message : String(error)}).`, 'warning');
        }
      })
    );
  }

  return { open, proveExits };
}

module.exports = { createParticipantLoader };
