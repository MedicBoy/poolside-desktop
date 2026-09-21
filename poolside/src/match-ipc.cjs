// Dashboard surface for local match coordination. Validation lives in the engine so the message the
// operator sees is the reason the operation was refused, not a generic rejection.

/** @param {{handle: (name: string, fn: (input: any) => any) => void, matches: {start: Function, complete: Function, cancel: Function, view: Function}}} deps */
function registerMatchIpc({ handle, matches }) {
  const id = value => (typeof value === 'string' ? value.trim() : '');

  handle('match:state', () => matches.view());
  handle('match:start', input => matches.start({ first: id(input?.first), second: id(input?.second) }));
  handle('match:complete', input => matches.complete({ matchId: id(input?.matchId), winner: id(input?.winner) }));
  handle('match:cancel', input =>
    matches.cancel({ matchId: id(input?.matchId), reason: typeof input?.reason === 'string' ? input.reason : '' })
  );
}

module.exports = { registerMatchIpc };
