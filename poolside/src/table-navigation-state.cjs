// Pure table-navigation state machine. It describes what must happen without sending game input.

const { TABLES } = require('./table-list.cjs');

const STAGE_TIMEOUT_MS = 120000;
const HISTORY_LIMIT = 24;
const TERMINAL_STATES = new Set(['complete', 'cancelled', 'failed']);
const STATES = [
  'locating-lobby',
  'opening-table-selection',
  'locating-table',
  'target-ready',
  'opening-table',
  'matchmaking',
  'complete',
  'cancelled',
  'failed'
];

function validTable(value) {
  if (!TABLES.includes(value)) throw new Error('Choose a supported target table.');
  return value;
}

function entry(from, to, event, detail, at) {
  return { at: new Date(at).toISOString(), from, to, event, detail: String(detail || '') };
}

function move(plan, to, event, detail, now) {
  if (!STATES.includes(to)) throw new Error(`Unknown table-navigation state: ${to}`);
  const history = [...(plan.history || []), entry(plan.state, to, event, detail, now)].slice(-HISTORY_LIMIT);
  return {
    ...plan,
    state: to,
    updatedAt: new Date(now).toISOString(),
    deadlineAt: TERMINAL_STATES.has(to) ? null : new Date(now + STAGE_TIMEOUT_MS).toISOString(),
    history
  };
}

function start(targetTable, options = {}) {
  const now = options.now ?? Date.now();
  const retryCount = Number.isInteger(options.retryCount) ? options.retryCount : 0;
  const plan = {
    mode: 'dry-run',
    targetTable: validTable(targetTable),
    state: 'locating-lobby',
    retryCount,
    startedAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    deadlineAt: new Date(now + STAGE_TIMEOUT_MS).toISOString(),
    lastObservation: null,
    history: []
  };
  return move(plan, 'locating-lobby', retryCount ? 'retry' : 'start', `Target: ${targetTable}`, now);
}

function expired(plan, now) {
  return Boolean(plan.deadlineAt && Date.parse(plan.deadlineAt) <= now);
}

function observationOf(screen) {
  const visibleTables = Array.isArray(screen?.visibleTables)
    ? screen.visibleTables.filter(table => TABLES.includes(table)).slice(0, TABLES.length)
    : [];
  return {
    state: typeof screen?.state === 'string' ? screen.state : 'unrecognized',
    visibleTables,
    observedAt: typeof screen?.observedAt === 'string' ? screen.observedAt : new Date().toISOString()
  };
}

function observe(plan, screen, now = Date.now()) {
  if (TERMINAL_STATES.has(plan.state)) return plan;
  if (expired(plan, now)) return timeout(plan, now);
  const lastObservation = observationOf(screen);
  const current = { ...plan, lastObservation };
  const state = lastObservation.state;
  if (state === 'connecting') return move(current, 'matchmaking', 'observed-connecting', 'Matchmaking screen observed.', now);
  if (state === 'lobby')
    return move(current, 'opening-table-selection', 'observed-lobby', 'Lobby observed; table selection is the next manual step.', now);
  if (state === 'table-selection') {
    const visible = lastObservation.visibleTables.includes(plan.targetTable);
    return move(
      current,
      visible ? 'target-ready' : 'locating-table',
      visible ? 'target-visible' : 'target-not-visible',
      visible ? `${plan.targetTable} is visible.` : `${plan.targetTable} is not visible in this observation.`,
      now
    );
  }
  if (state === 'loading') return move(current, plan.state, 'observed-loading', 'The game is still loading.', now);
  if (['shop', 'lucky-promotion', 'lucky-shot'].includes(state))
    return move(current, 'locating-lobby', 'observed-detour', `${state} must be left before table navigation can continue.`, now);
  return move(current, plan.state, 'observation-inconclusive', `Observed ${state}; no navigation claim was made.`, now);
}

function advance(plan, now = Date.now()) {
  if (expired(plan, now)) return timeout(plan, now);
  if (plan.state === 'opening-table-selection')
    return move(plan, 'locating-table', 'manual-step-complete', 'Table selection was opened manually.', now);
  if (plan.state === 'target-ready')
    return move(plan, 'opening-table', 'manual-step-complete', `${plan.targetTable} was opened manually.`, now);
  throw new Error('There is no manual navigation step to confirm right now.');
}

function confirmMatchReady(plan, now = Date.now()) {
  if (plan.state !== 'matchmaking') throw new Error('Matchmaking has not been observed yet.');
  return move(plan, 'complete', 'match-ready', 'A future validated match-ready observation completed the plan.', now);
}

function cancel(plan, now = Date.now()) {
  if (TERMINAL_STATES.has(plan.state)) return plan;
  return move(plan, 'cancelled', 'cancel', 'The dry run was cancelled.', now);
}

function timeout(plan, now = Date.now()) {
  if (TERMINAL_STATES.has(plan.state)) return plan;
  return move(plan, 'failed', 'timeout', `No progress was confirmed within ${STAGE_TIMEOUT_MS / 1000} seconds.`, now);
}

function retry(plan, now = Date.now()) {
  if (!['failed', 'cancelled'].includes(plan.state)) throw new Error('Only a failed or cancelled navigation can be retried.');
  return start(plan.targetTable, { now, retryCount: (plan.retryCount || 0) + 1 });
}

function requiredAction(plan) {
  if (plan.state === 'locating-lobby') {
    return plan.lastObservation && ['shop', 'lucky-promotion', 'lucky-shot'].includes(plan.lastObservation.state)
      ? 'return-to-lobby'
      : 'inspect-screen';
  }
  if (plan.state === 'opening-table-selection') return 'open-table-selection';
  if (plan.state === 'locating-table') return plan.lastObservation?.state === 'table-selection' ? 'search-table-list' : 'inspect-screen';
  if (plan.state === 'target-ready') return 'open-target-table';
  if (['opening-table', 'matchmaking'].includes(plan.state)) return 'inspect-screen';
  if (plan.state === 'failed') return 'retry';
  return null;
}

module.exports = {
  STATES,
  STAGE_TIMEOUT_MS,
  HISTORY_LIMIT,
  start,
  observe,
  advance,
  confirmMatchReady,
  cancel,
  timeout,
  retry,
  requiredAction,
  expired
};
