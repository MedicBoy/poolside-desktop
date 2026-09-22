// What a support bundle says about the state the machine was in — in counts, flags and field names, and never
// a value.

const test = require('node:test');
const assert = require('node:assert/strict');
const { stateSummary } = require('../src/diagnostics-state.cjs');
const diagnosticsBundle = require('../src/diagnostics-bundle.cjs');

const account = overrides => ({
  id: 'a',
  name: 'Newfie',
  status: 'ready',
  overview: { identity: { userAgent: null, locale: null, timezone: null, viewport: null, colorScheme: null, acceptLanguages: null } },
  ...overrides
});

test('a bundle states the shape of the workspace without saying anything private', () => {
  const summary = stateSummary(
    {
      version: '0.3.11',
      readOnly: true,
      accounts: [
        account({ status: 'ready', overview: { identity: { timezone: 'Europe/London', locale: 'en-GB' } } }),
        account({ id: 'b', name: 'Gmail', status: 'closed' })
      ],
      archivedAccounts: [account({ id: 'c', name: 'Old' })],
      routePresets: [{ id: '1', name: 'London-1' }],
      matches: { totals: { recorded: 7, active: 1 }, runs: { active: { paused: true }, recent: [{}, {}] } },
      attention: { items: [{ code: 'workspace-read-only', level: 'warning', title: 'Names live here' }] }
    },
    { workspaceBytes: 4096, workspaceWrittenAt: '2026-09-22T00:00:00.000Z', recoveryCandidates: 2 }
  );
  assert.deepEqual(summary, {
    readOnly: true,
    version: '0.3.11',
    accounts: { active: 2, archived: 1, open: 1 },
    identityFieldsInUse: ['locale', 'timezone'],
    routePresets: 1,
    matches: { recorded: 7, active: 1 },
    runs: { active: true, paused: true, recent: 2 },
    attention: [{ code: 'workspace-read-only', level: 'warning' }],
    recovery: { candidates: 2 },
    files: { workspaceBytes: 4096, workspaceWrittenAt: '2026-09-22T00:00:00.000Z' }
  });
  // Not one value from the identity, and not one name: field names and codes are all that travel.
  const serialised = JSON.stringify(summary);
  for (const forbidden of ['Europe/London', 'en-GB', 'Names live here', 'Gmail', 'London-1'])
    assert.equal(serialised.includes(forbidden), false, `${forbidden} must not be in a support bundle`);
});

test('an empty or missing snapshot still produces a well-formed state block', () => {
  assert.deepEqual(stateSummary(null), {
    readOnly: false,
    version: null,
    accounts: { active: 0, archived: 0, open: 0 },
    identityFieldsInUse: [],
    routePresets: 0,
    matches: {},
    runs: { active: false, paused: false, recent: 0 },
    attention: [],
    recovery: { candidates: 0 },
    files: { workspaceBytes: null, workspaceWrittenAt: null }
  });
});

test('the payload the bundle prepares carries the state block and still passes its own secret scan', () => {
  const prepared = diagnosticsBundle.prepare(
    {
      version: '0.3.11',
      readOnly: false,
      accounts: [account({ status: 'failed', statusReason: 'Configuration refused: timezone' })],
      archivedAccounts: [],
      routePresets: [],
      matches: { totals: { recorded: 1 }, runs: { recent: [] } },
      attention: { items: [{ code: 'session-failed', level: 'warning', title: 'Newfie did not load' }] },
      telemetry: null,
      timeline: { entries: [] }
    },
    { workspaceBytes: 1194, workspaceWrittenAt: '2026-09-22T00:00:00.000Z', recoveryCandidates: 1 }
  );
  assert.equal(prepared.clean, true);
  assert.equal(prepared.payload.state.accounts.active, 1);
  assert.equal(prepared.payload.state.recovery.candidates, 1);
  assert.deepEqual(prepared.payload.state.attention, [{ code: 'session-failed', level: 'warning' }]);
  assert.equal(JSON.stringify(prepared.payload.state).includes('Newfie'), false, 'the state block names nobody');
});
