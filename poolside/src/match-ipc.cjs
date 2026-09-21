// Dashboard surface for local match coordination. Validation lives in the engine so the message the
// operator sees is the reason the operation was refused, not a generic rejection.

/** @param {{handle: (name: string, fn: (input: any) => any) => void, matches: {start: Function, startRun: Function, stopRun: Function, checkPairing: Function, complete: Function, cancel: Function, load: Function, view: Function}}} deps */
function registerMatchIpc({ handle, matches }) {
  const id = value => (typeof value === 'string' ? value.trim() : '');

  handle('match:state', () => matches.view());
  // `load` defaults to true: starting a match brings both participants' sessions up, which is what
  // starting it means. Passing load:false records the pairing without opening any window.
  handle('match:start', input => matches.start({ first: id(input?.first), second: id(input?.second), load: input?.load !== false }));
  handle('match:load', input => matches.load({ matchId: id(input?.matchId) }));
  // Pairing evidence is judged from the two sessions' own screen readings. Asking for it again is what the
  // operator does after looking at both windows, so the answer comes back whether or not it has changed.
  handle('match:pairing', input => matches.checkPairing({ matchId: id(input?.matchId) }));
  handle('match:complete', input => matches.complete({ matchId: id(input?.matchId), winner: id(input?.winner) }));
  handle('match:cancel', input =>
    matches.cancel({ matchId: id(input?.matchId), reason: typeof input?.reason === 'string' ? input.reason : '' })
  );
  // A run is the plan above the matches: the same two accounts, a limit, and the conditions that stop it.
  // Starting a run also starts its first match, so "start" means one thing to the operator.
  handle('run:start', input =>
    matches.startRun({
      first: id(input?.first),
      second: id(input?.second),
      plan: input?.plan,
      load: input?.load !== false
    })
  );
  handle('run:stop', input => matches.stopRun({ runId: id(input?.runId), reason: typeof input?.reason === 'string' ? input.reason : '' }));
}

module.exports = { registerMatchIpc };
