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
  const { runDropoutCheck } = require('./self-test-dropout.cjs');
  const { runRunPlanChecks } = require('./self-test-run-plan.cjs');

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

  // --- The count-in: one moment to aim at, and a measurement of what two hands achieved ----------------
  // It sends no input to the game — the two queue clicks are the operator's — so what is proved here is the
  // clock and the record: it refuses before release, counts, calls GO in the match's own history, and stops
  // when asked. The gap between two real clicks is measured from the screens, which needs a live pair.
  const countIn = await dashboard.webContents.executeJavaScript(`(async () => {
    const state = await poolside.get();
    const matchId = state.value.matches.active[0].matchId;
    const armed = await poolside.armRelease({ matchId, leadInMs: 1500 });
    const during = armed.ok ? armed.value.release : null;
    const until = Date.now() + 15000;
    let events = [];
    while (Date.now() < until) {
      const live = (await poolside.get()).value.matches.active.find(match => match.matchId === matchId);
      events = live ? live.history.map(entry => entry.event) : [];
      if (events.includes('count-in-go')) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const stopped = await poolside.cancelRelease({ matchId });
    const after = (await poolside.get()).value.matches.active.find(match => match.matchId === matchId);
    return {
      armedOk: armed.ok,
      armedError: String(armed.error || ''),
      phase: during ? during.phase : null,
      line: during ? during.line : null,
      events,
      stoppedOk: stopped.ok,
      cancelled: after && after.release ? after.release.phase : null
    };
  })()`);
  assert.equal(countIn.armedOk, true, `the count-in could not start: ${countIn.armedError}`);
  assert.equal(countIn.phase, 'counting');
  assert.match(countIn.line, /click Test receiver's Play button, then Test sender's\./);
  assert.ok(countIn.events.includes('count-in-go'), 'the moment to click is recorded in the match history');
  assert.equal(countIn.stoppedOk, true);
  assert.equal(countIn.cancelled, 'cancelled', 'the card says the count-in was stopped');

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
      // The balances around the match: this suite's fixture sessions have no screen readings, so the honest
      // answer is "not read" rather than a change nobody observed.
      outcomeVerdict: after.value.matches.recent[0].outcome ? after.value.matches.recent[0].outcome.verdict : null,
      outcomeReason: after.value.matches.recent[0].outcome ? after.value.matches.recent[0].outcome.reason : '',
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
  assert.equal(matchFlow.outcomeVerdict, 'incomplete', 'no readings means no claim about the balances');
  assert.match(matchFlow.outcomeReason, /no balance reading before or after/);
  assert.equal(matchFlow.capabilityMode, 'available', 'the capability report agrees the coordinator exists');
  assert.equal(matchFlow.navigable, 1, 'the coordinator has its own dashboard view');
  assert.ok(matchFlow.logged >= 2, 'the pairing and the result both reached the activity history');

  await runRunPlanChecks(ctx, assert);

  // The windows themselves, not just the ledger: a real window per participant, on the game URL, with an
  // FSM that has left `closed`. This is the part a recorded pairing alone could not prove.
  for (const id of matchAccountIds) {
    const group = sessions.get(id);
    assert.ok(group && !group.window.isDestroyed(), 'starting a match opened a real window for each participant');
    assert.equal(group.window.webContents.getURL(), GAME_URL, 'the window loaded the game URL');
    assert.notEqual(group.fsm.state, 'closed');
  }

  await assertBothWindowsReadable();

  // Leave the session map as this check found it, then stop serving the fixture.
  await dashboard.webContents.executeJavaScript(
    `(async () => { for (const id of ${JSON.stringify(matchAccountIds)}) await poolside.close(id); })()`
  );
  for (const partitionSession of matchPartitions) partitionSession.protocol.unhandle('https');
  for (const id of matchAccountIds) assert.equal(sessions.has(id), false, 'each window this check opened was closed again');

  // Both windows are closed now, which is the state the dropout check needs.
  await runDropoutCheck(ctx, assert);
  /**
   * Both windows readable at once, focused or not. Live status used to read only the focused window, so two
   * readings could never be fresh together and a pairing could never be judged — the operator reported it as
   * "if i click on one the other one isnt getting read". Only one window can hold focus, so this asks about
   * both while one of them does.
   */
  async function assertBothWindowsReadable() {
    sessions.get(matchAccountIds[0]).window.focus();
    for (const id of matchAccountIds) ctx.monitor.start(id);
    assert.equal(
      matchAccountIds.filter(id => sessions.get(id).window.isFocused()).length,
      1,
      'one window holds focus, as a desktop allows'
    );
    const readable = [];
    for (const id of matchAccountIds) {
      const group = sessions.get(id);
      const contents = group.window.webContents;
      readable.push({
        destroyed: group.window.isDestroyed(),
        url: contents.isDestroyed() ? 'destroyed' : contents.getURL().slice(0, 40),
        state: await contents.executeJavaScriptInIsolatedWorld(999, [{ code: 'document.visibilityState' }]),
        sampleable: ctx.monitor.status(id).sampleable
      });
    }
    for (const id of matchAccountIds) ctx.monitor.stop(id);
    assert.deepEqual(
      readable.map(entry => entry.sampleable),
      [true, true],
      `both windows are readable, focused or not: ${JSON.stringify(readable)}`
    );
    // Whether a page reports itself on screen is the environment's business, not the application's: on a real
    // desktop both do, and on a locked or non-interactive one a window behind another may not. What the app
    // guarantees is that this answer decides, and that a hidden window is skipped rather than read from stale
    // pixels — pinned deterministically in test/screen-monitor.test.cjs.
    for (const entry of readable) {
      assert.equal(entry.destroyed, false);
      assert.match(entry.url, /8ballpool\.com/);
      assert.ok(['visible', 'hidden'].includes(entry.state), `a page reports itself visible or hidden: ${JSON.stringify(readable)}`);
    }
  }
}

module.exports = { runMatchChecks };
