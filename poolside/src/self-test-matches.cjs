// The match-coordination scenario of the self-test: pairing two real accounts, loading both profiles,
// holding them at the readiness barrier, recording a result, and the refusals that keep the ledger honest.
//
// Split out of self-test.cjs to keep both modules under the size ceiling (test/architecture.test.cjs).
// Loaded only when --self-test runs. It deliberately runs last: opening profiles genuinely creates their
// storage, and the profile-lifecycle check asserts what a scan finds when the storage is only what it made.
//
// Starting a match brings up both profiles, and that path ends in a navigation to the live game URL. So
// the game URL is served from a local fixture on each account's own partition first: the real opener, the
// real window and the real navigation all run, with nothing sent to the game site and no network needed.

/**
 * @param {import('./self-test.cjs').SelfTestContext} ctx
 * @param {typeof import('node:assert/strict')} assert
 */
async function runMatchChecks(ctx, assert) {
  const { workspace, sessions, session, GAME_URL } = ctx;
  const dashboard = workspace.dashboard;
  const { partition } = require('./saved-session.cjs');

  /** Read the live barrier for the only active match until it leaves `preparing`, or time out. */
  async function waitForRelease(timeoutMs = 15000) {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const readiness = await dashboard.webContents.executeJavaScript(`(async () => {
        const state = await poolside.get();
        const active = state.value.matches.active[0];
        if (!active) return null;
        return {
          verdict: active.readiness ? active.readiness.verdict : 'missing',
          reason: active.readiness ? active.readiness.reason : 'no barrier was recorded',
          releasedAt: active.readiness ? active.readiness.releasedAt : null,
          skewMs: active.readiness ? active.readiness.skewMs : null,
          participants: active.participants.map(entry => ({ name: entry.name, open: entry.open, ready: entry.ready }))
        };
      })()`);
      if (!readiness || readiness.verdict !== 'preparing' || Date.now() > until) return readiness;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }

  const matchAccountIds = workspace.data.accounts.slice(0, 2).map(account => account.id);
  const matchPartitions = matchAccountIds.map(id => session.fromPartition(partition(id)));
  const localGameFixture = '<title>Poolside fixture game surface</title><h1>9 BALL</h1>';
  for (const partitionSession of matchPartitions) partitionSession.protocol.handle('https', () => new Response(localGameFixture));

  const started = await dashboard.webContents.executeJavaScript(`(async () => {
    const before = await poolside.get();
    const [first, second] = before.value.accounts.map(account => account.id);
    const result = await poolside.startMatch({ first, second });
    return { ok: result.ok, active: result.value.totals.active, load: result.value.load.map(entry => entry.opened) };
  })()`);
  assert.equal(started.ok, true, 'two accounts can be paired locally');
  assert.equal(started.active, 1);
  assert.deepEqual(started.load, [true, true], 'starting the match brought both profiles up');

  // The barrier advances on the service's own check loop, the same one the dashboard relies on, so this
  // waits for release rather than nudging it from the test.
  const released = await waitForRelease();
  assert.equal(released.verdict, 'ready', `the match was not released: ${released.reason}`);
  assert.ok(released.releasedAt, 'release is timestamped');
  assert.ok(Number.isFinite(released.skewMs) && released.skewMs >= 0, 'release records how long the barrier took');
  assert.deepEqual(
    released.participants.map(entry => [entry.name, entry.open, entry.ready]),
    [
      ['Test receiver', true, true],
      ['Test sender', true, true]
    ],
    'every participant is reported ready at release'
  );

  const matchFlow = await dashboard.webContents.executeJavaScript(`(async () => {
    const state = await poolside.get();
    const matchId = state.value.matches.active[0].matchId;
    const refused = await poolside.startMatch({ first: state.value.accounts[0].id, second: state.value.accounts[1].id });
    const settled = await poolside.completeMatch({ matchId, winner: state.value.accounts[1].id });
    const refusedResult = await poolside.completeMatch({ matchId, winner: state.value.accounts[0].id });
    const after = await poolside.get();
    const capability = after.value.capabilityReport.capabilities.find(item => item.id === 'match-coordination');
    return {
      refusedOk: refused.ok,
      refusedError: refused.error,
      settledOk: settled.ok,
      settledCompleted: settled.value.totals.completed,
      secondResultOk: refusedResult.ok,
      ledger: after.value.matches.totals,
      winner: after.value.matches.recent[0].winnerName,
      capabilityMode: capability ? capability.mode : 'missing',
      navigable: document.querySelectorAll('[data-view="matches"]').length,
      logged: after.value.events.filter(event => /in progress|recorded as the winner|ready/i.test(event.message)).length
    };
  })()`);
  assert.equal(matchFlow.refusedOk, false, 'an account cannot hold two matches at once');
  assert.match(matchFlow.refusedError, /already in an active match/);
  assert.equal(matchFlow.settledOk, true);
  assert.equal(matchFlow.settledCompleted, 1);
  assert.equal(matchFlow.secondResultOk, false, 'a settled match cannot record a second result');
  assert.deepEqual(matchFlow.ledger, { recorded: 1, active: 0, completed: 1, cancelled: 0 });
  assert.equal(matchFlow.winner, 'Test sender');
  assert.equal(matchFlow.capabilityMode, 'available', 'the capability report agrees the coordinator exists');
  assert.equal(matchFlow.navigable, 1, 'the coordinator has its own dashboard view');
  assert.ok(matchFlow.logged >= 2, 'the pairing and the result both reached the activity history');

  // The windows themselves, not just the ledger: a real window per participant, on the game URL, with an
  // FSM that has left `closed`. This is the part a recorded pairing alone could not prove.
  for (const id of matchAccountIds) {
    const group = sessions.get(id);
    assert.ok(group && !group.window.isDestroyed(), 'starting a match opened a real window for each participant');
    assert.equal(group.window.webContents.getURL(), GAME_URL, 'the window loaded the game URL');
    assert.notEqual(group.fsm.state, 'closed');
  }
  // Leave the session map as this check found it, then stop serving the fixture.
  await dashboard.webContents.executeJavaScript(
    `(async () => { for (const id of ${JSON.stringify(matchAccountIds)}) await poolside.close(id); })()`
  );
  for (const partitionSession of matchPartitions) partitionSession.protocol.unhandle('https');
  for (const id of matchAccountIds) assert.equal(sessions.has(id), false, 'each window this check opened was closed again');
}

module.exports = { runMatchChecks };
