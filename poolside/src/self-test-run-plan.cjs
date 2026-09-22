// The run-plan scenario of the self-test: a plan, its matches, and the program ending the run itself.
//
// Split out of `self-test-matches.cjs`, which had reached the module ceiling. It drives the real bridge: a run
// is started with a two-match plan, two results are recorded, and the plan — not the test — ends the run. What
// that proves is that the limit is enforced by the program rather than noticed by the operator afterwards.

/**
 * @param {import('./self-test.cjs').SelfTestContext} ctx
 * @param {typeof import('node:assert/strict')} assert
 */
async function runRunPlanChecks(ctx, assert) {
  const dashboard = ctx.workspace.dashboard;
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
    // The run dashboard: where the run is, what its release state is, how old the readings are, what will
    // stop it next and what to do now. Live session state comes from the snapshot, not from the reply, and the
    // barrier releases on its own check loop — so this waits for the release the way the dashboard does,
    // rather than assuming the first look already shows one.
    const until = Date.now() + 15000;
    let opening = null;
    while (Date.now() < until) {
      opening = (await poolside.get()).value.matches.runs.active.status;
      if (opening && opening.stage !== 'preparing') break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
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
      openingStage: opening ? opening.stage : null,
      openingAction: opening ? opening.nextAction : null,
      openingSkew: opening ? opening.skewMs : 'missing',
      openingObserved: opening ? opening.observations.length : -1,
      openingNextStop: opening ? opening.nextStop : null,
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
      endedStage: ended && ended.status ? ended.status.stage : null,
      endedStop: ended && ended.status ? ended.status.stop : null,
      endedNext: ended && ended.status ? ended.status.nextAction : null,
      participants: ended ? ended.participants.map(entry => [entry.name, entry.role]) : [],
      thirdOk: third.ok,
      thirdRunId: third.ok ? third.value.active[0].runId : 'none',
      tidyOk: tidy ? tidy.ok : null
    };
  })()`);
  assert.equal(runFlow.error, undefined, `the run could not be started: ${runFlow.error}`);
  assert.equal(runFlow.joined, true, 'the first match of a run belongs to the run');
  // The run dashboard as the operator sees it: a stage, a release line, one reading per participant, what
  // will stop the run next, and the one thing to do now.
  assert.equal(runFlow.openingObserved, 2, 'the status reports one screen reading per participant');
  assert.ok(runFlow.openingAction && runFlow.openingAction.length > 20, 'the status says what to do next');
  assert.match(runFlow.openingNextStop, /^Stops when: /);
  // Both sessions are already open and ready from the match check, so this releases without any help; the wait
  // above is what makes the reading of the card deterministic rather than a race with the barrier.
  assert.equal(runFlow.openingStage, 'released');
  assert.ok(Number.isFinite(runFlow.openingSkew) && runFlow.openingSkew >= 0, `unexpected skew: ${runFlow.openingSkew}`);
  assert.match(runFlow.openingAction, /Play this match/);
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
  assert.equal(runFlow.endedStage, 'ended');
  assert.equal(runFlow.endedStop.label, 'Match limit reached');
  assert.match(runFlow.endedStop.reason, /2 matches with a recorded result/);
  assert.match(runFlow.endedNext, /this run is over/);
  // The plan stops the run; it does not lock the pair out. A match started afterwards is a match on its own.
  assert.equal(runFlow.thirdOk, true);
  assert.equal(runFlow.thirdRunId, null);
  assert.equal(runFlow.tidyOk, true);

  // --- A record of the runs, written where the operator can find it ----------------------------------
  // The point of the report is that it can be sent on: what it holds, and what it must not hold, are both part
  // of the contract. It is written beside the diagnostics export, and the renderer learns a file name, not a path.
  const reported = await dashboard.webContents.executeJavaScript(`(async () => {
    const saved = await poolside.saveRunReport();
    return { ok: saved.ok, error: String(saved.error || ''), fileName: saved.ok ? saved.value.fileName : '', runs: saved.ok ? saved.value.runs : -1 };
  })()`);
  assert.equal(reported.ok, true, `the run report was refused: ${reported.error}`);
  assert.match(reported.fileName, /^poolside-run-report-.*\.json$/);
  assert.equal(reported.fileName.includes('\\'), false, 'the renderer receives no filesystem path');
  assert.ok(reported.runs >= 1, 'the report covers the run this check made');
  const reportPath = require('node:path').join(ctx.app.getPath('userData'), 'diagnostics', reported.fileName);
  const written = JSON.parse(ctx.fs.readFileSync(reportPath, 'utf8'));
  assert.equal(written.format, 'poolside-run-report/v1');
  assert.equal(written.runs.length >= 1, true);
  assert.ok(
    written.runs.some(run => (run.matches || []).length >= 2),
    'the run carries the matches it owned'
  );
  // The note is a fixed sentence naming what is absent; the data is what must be free of those things.
  const serialised = JSON.stringify({ runs: written.runs, standaloneMatches: written.standaloneMatches }).toLowerCase();
  assert.equal(serialised.includes('test receiver'), true, 'the record names who played, or it is not a record');
  for (const forbidden of ['password', 'proxy', 'spec'])
    assert.equal(serialised.includes(forbidden), false, `${forbidden} must not be in a report that can be sent on`);
}

module.exports = { runRunPlanChecks };
