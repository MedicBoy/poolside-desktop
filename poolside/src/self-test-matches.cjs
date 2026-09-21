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

  // --- Pairing evidence: two loaded profiles are not a pairing ------------------------------------------
  // The suite loads the game fixture rather than the game, so neither session has a screen reading, and the
  // answer has to be exactly that. This is the rule the roadmap states in words — two connecting screens are
  // not proof — asserted against the real bridge rather than in a unit test alone.
  const pairingFlow = await dashboard.webContents.executeJavaScript(`(async () => {
    const state = await poolside.get();
    const matchId = state.value.matches.active[0].matchId;
    const recorded = state.value.matches.active[0].pairing;
    const asked = await poolside.checkMatchPairing({ matchId });
    const after = (await poolside.get()).value.matches.active[0];
    return {
      verdict: recorded ? recorded.verdict : null,
      label: recorded ? recorded.label : null,
      reason: recorded ? recorded.reason : null,
      checkedAt: recorded ? recorded.checkedAt : null,
      askedOk: asked.ok,
      askedVerdict: asked.ok && asked.value.pairing ? asked.value.pairing.verdict : null,
      stillUnproven: after.pairing ? after.pairing.verdict : null,
      history: after.history.map(entry => entry.event)
    };
  })()`);
  assert.equal(pairingFlow.verdict, 'incomplete', 'two loaded profiles with no screen reading are not a pairing');
  assert.equal(pairingFlow.label, 'Not enough evidence yet');
  assert.equal(pairingFlow.reason, 'No screen reading yet from Test receiver and Test sender.');
  assert.ok(pairingFlow.checkedAt, 'the verdict is timestamped');
  assert.equal(pairingFlow.askedOk, true, 'the evidence can be asked for again from the dashboard');
  assert.equal(pairingFlow.askedVerdict, 'incomplete');
  assert.equal(pairingFlow.stillUnproven, 'incomplete', 'asking again does not turn missing evidence into a pairing');
  assert.ok(pairingFlow.history.includes('pairing-evidence'), 'the verdict is part of the match history');

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

  // --- A run plan: the plan stops the run, not the operator watching a counter -------------------------
  // The whole point of a plan is that its limit is enforced. This drives it through the real bridge: two
  // matches are recorded under the plan, the plan is met, and the program — not the test — ends the run.
  const runFlow = await dashboard.webContents.executeJavaScript(`(async () => {
    const snapshot = await poolside.get();
    const ids = snapshot.value.accounts.map(account => account.id);
    const started = await poolside.startRun({
      first: ids[0],
      second: ids[1],
      plan: { table: 'Rome', matchLimit: 2, stopAfterFailures: 3, stopAfterMinutes: 60 },
      load: false
    });
    if (!started.ok) return { error: started.error };
    const runId = started.value.runs.active.runId;
    const joined = started.value.active[0].runId === runId;
    const record = async winner => {
      const live = (await poolside.get()).value.matches.active[0];
      return poolside.completeMatch({ matchId: live.matchId, winner });
    };
    const one = await record(ids[1]);
    const afterOne = (await poolside.get()).value.matches.runs.active;
    const next = await poolside.startMatch({ first: ids[0], second: ids[1], load: false });
    const two = await record(ids[0]);
    const after = await poolside.get();
    const ended = after.value.matches.runs.recent[0];
    const third = await poolside.startMatch({ first: ids[0], second: ids[1], load: false });
    const tidy = third.ok ? await poolside.cancelMatch({ matchId: third.value.active[0].matchId }) : null;
    return {
      joined,
      oneOk: one.ok,
      afterOneActive: Boolean(afterOne),
      afterOneCompleted: afterOne ? afterOne.progress.completed : -1,
      nextJoined: next.ok ? next.value.active[0].runId === runId : null,
      twoOk: two.ok,
      activeAfterLimit: after.value.matches.runs.active,
      outcome: ended ? ended.outcome : null,
      outcomeLabel: ended ? ended.outcomeLabel : null,
      reason: ended ? ended.reason : null,
      describe: ended ? ended.describe : null,
      participants: ended ? ended.participants.map(entry => [entry.name, entry.role]) : [],
      thirdOk: third.ok,
      thirdRunId: third.ok ? third.value.active[0].runId : 'none',
      tidyOk: tidy ? tidy.ok : null
    };
  })()`);
  assert.equal(runFlow.error, undefined, `the run could not be started: ${runFlow.error}`);
  assert.equal(runFlow.joined, true, 'the first match of a run belongs to the run');
  assert.equal(runFlow.oneOk, true);
  assert.equal(runFlow.afterOneActive, true, 'one match is not the whole plan');
  assert.equal(runFlow.afterOneCompleted, 1);
  assert.equal(runFlow.nextJoined, true, 'the next match is added to the run in progress');
  assert.equal(runFlow.twoOk, true);
  assert.equal(runFlow.activeAfterLimit, null, 'reaching the limit ended the run');
  assert.equal(runFlow.outcome, 'limit');
  assert.equal(runFlow.outcomeLabel, 'Match limit reached');
  assert.match(runFlow.reason, /2 matches with a recorded result/);
  assert.match(runFlow.describe, /on Rome/);
  assert.deepEqual(runFlow.participants, [
    ['Test receiver', 'receiver'],
    ['Test sender', 'sender']
  ]);
  // The plan stops the run; it does not lock the pair out. A match started afterwards is a match on its own.
  assert.equal(runFlow.thirdOk, true);
  assert.equal(runFlow.thirdRunId, null);
  assert.equal(runFlow.tidyOk, true);

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
