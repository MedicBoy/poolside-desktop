// The dropout scenario of the self-test: a match with no session behind it.
//
// Split out of `self-test-matches.cjs`, which had reached the module ceiling. It deliberately runs after that
// check has closed both windows, because "no window is open" is the state being tested — and it is the state
// the operator reported: "I just tried to start a match and it says I am already in a match. I have nothing
// open at the moment." A match that cannot be played must not be able to lock an account out.

/**
 * @param {import('./self-test.cjs').SelfTestContext} ctx
 * @param {typeof import('node:assert/strict')} assert
 */
async function runDropoutCheck(ctx, assert) {
  const dashboard = ctx.workspace.dashboard;
  const dropout = await dashboard.webContents.executeJavaScript(`(async () => {
    const state = await poolside.get();
    const ids = state.value.accounts.map(account => account.id);
    const started = await poolside.startMatch({ first: ids[0], second: ids[1], load: false });
    if (!started.ok) return { error: started.error };
    const matchId = started.value.active[0].matchId;
    // Nothing is open, so nothing can be queued: the count-in refuses until the barrier has released a match.
    const armed = await poolside.armRelease({ matchId });
    // Live session state comes from the snapshot, not from the reply: the reply is the ledger, and whether a
    // window is open is process state that the dashboard view resolves.
    const first = (await poolside.get()).value.matches.active.find(match => match.matchId === matchId);
    const open = first.participants.map(entry => entry.open);
    const until = Date.now() + 45000;
    let settled = null;
    while (Date.now() < until) {
      settled = (await poolside.get()).value.matches.recent.find(match => match.matchId === matchId) || null;
      if (settled) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const after = await poolside.get();
    return {
      open,
      armRefused: !armed.ok,
      armError: String(armed.error || ''),
      cancelled: Boolean(settled),
      reason: settled ? settled.reason : '',
      active: after.value.matches.totals.active,
      freed: (await poolside.startMatch({ first: ids[0], second: ids[1], load: false })).ok
    };
  })()`);
  assert.deepEqual(dropout.open, [false, false], 'neither participant has a window behind it, as the operator reported');
  assert.equal(dropout.armRefused, true, 'a count-in over a match with no window is refused');
  assert.match(dropout.armError, /waits until both profiles are released\./);
  assert.equal(dropout.cancelled, true, `the match with no session was not cleared: ${dropout.reason}`);
  assert.match(dropout.reason, /session has been closed for \d+ seconds, so m\d+ was cancelled as a dropout\./);
  assert.equal(dropout.active, 0, 'nothing is left in progress once the match with no session behind it is cleared');
  assert.equal(dropout.freed, true, 'and the same two accounts can be paired again straight away');
  // Leave the ledger as the suite found it: cancel the match this check started.
  await dashboard.webContents.executeJavaScript(`(async () => {
    const state = await poolside.get();
    for (const match of state.value.matches.active) await poolside.cancelMatch({ matchId: match.matchId });
  })()`);
}

module.exports = { runDropoutCheck };
