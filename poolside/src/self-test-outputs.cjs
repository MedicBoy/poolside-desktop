// The self-test's view of the files Poolside wrote itself.
//
// Split out of `self-test.cjs`, which was at the module ceiling, and it belongs on its own anyway: erasing is
// irreversible and the self-test's native confirmation always declines, so this asserts the half that can be
// proved end to end — the view lists the application's own documents by name and never by path, and a refused
// confirmation leaves every one of them on disk. That the deletion itself works is pinned by unit tests.

/**
 * @param {import('./self-test.cjs').SelfTestContext} ctx
 * @param {typeof import('node:assert/strict')} assert
 */
async function runOutputChecks(ctx, assert) {
  const outputs = await ctx.workspace.dashboard.webContents.executeJavaScript(`(async () => {
    const listed = await poolside.outputsList();
    const entries = listed.ok ? listed.value.entries : [];
    const report = entries.find(entry => entry.kind === 'run-report') || null;
    const declined = report ? await poolside.outputsClear({ names: [report.name] }) : null;
    const after = await poolside.outputsList();
    return {
      ok: listed.ok,
      error: String(listed.error || ''),
      kinds: Array.from(new Set(entries.map(entry => entry.kind))).sort(),
      names: entries.map(entry => entry.name),
      serialised: listed.ok ? JSON.stringify(listed.value) : '',
      declinedOk: declined ? declined.ok : null,
      declinedError: declined ? String(declined.error || '') : '',
      stillListed: after.ok && report ? after.value.entries.some(entry => entry.name === report.name) : false
    };
  })()`);
  assert.equal(outputs.ok, true, `the file list was refused: ${outputs.error}`);
  assert.deepEqual(outputs.kinds, ['diagnostics', 'run-report'], 'both documents this application writes are listed');
  assert.ok(
    outputs.names.every(name => /^poolside-(diagnostics|run-report)-/.test(name)),
    "the list holds nothing but the application's own documents"
  );
  assert.equal(outputs.serialised.includes('\\'), false, 'the view carries names, never a path');
  assert.equal(outputs.declinedOk, false, 'a declined confirmation erases nothing');
  assert.match(outputs.declinedError, /Nothing was erased/);
  assert.equal(outputs.stillListed, true, 'and the file it named is still there afterwards');
}

module.exports = { runOutputChecks };
