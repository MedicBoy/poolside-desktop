// The shape of a run record, and the only place that decides whether a stored one is trusted.
//
// Split out of `match-record.cjs`, which had reached the module ceiling while carrying the shape of two things:
// a match, and the run a match may belong to. A run is read back from the same file and shown on the same
// dashboard, so it needs exactly the same treatment — every field arrives from somewhere that could be wrong.

const runPlan = require('./run-plan.cjs');
const { text, NAME_LIMIT, TEXT_LIMIT, ID_LIMIT } = require('./record-text.cjs');

/** Runs are rarer than matches and are the record of a plan, so fewer are kept. */
const RUN_LEDGER_LIMIT = 50;
const RUN_HISTORY_LIMIT = 8;

const RUN_STATES = ['active', 'paused', 'ended'];
/** What ended a run. `limit` is the plan finishing; the rest are stops. */
const RUN_OUTCOMES = ['limit', 'failures', 'unconfirmed', 'duration', 'stopped', 'participants'];
const ROLES = ['receiver', 'sender'];

function cleanParticipant(value) {
  if (!value || typeof value !== 'object') return null;
  const id = text(value.id, ID_LIMIT);
  const name = text(value.name, NAME_LIMIT);
  return id && name ? { id, name } : null;
}

/** A run's participant also records the role the account played. */
function cleanRunParticipant(value) {
  const participant = cleanParticipant(value);
  if (!participant) return null;
  const role = value && ROLES.includes(value.role) ? value.role : null;
  return role ? { ...participant, role } : null;
}

/** A run's history entry carries no state transition, only what happened and when. */
function cleanRunHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(entry => {
      if (!entry || typeof entry !== 'object') return null;
      const at = text(entry.at, 40);
      const event = text(entry.event, 32);
      if (!Number.isFinite(Date.parse(at)) || !/^[a-z0-9-]+$/.test(event)) return null;
      return { at, event, detail: text(entry.detail, TEXT_LIMIT) };
    })
    .filter(Boolean)
    .slice(-RUN_HISTORY_LIMIT);
}

/**
 * A run, or null. The plan is re-validated rather than trusted: a stored plan is a stored decision, and a run
 * whose plan cannot be read is a run whose stop conditions cannot be enforced.
 * @param {unknown} value
 */
function cleanRun(value) {
  if (!value || typeof value !== 'object') return null;
  const source = /** @type {any} */ (value);
  const handle = text(source.handle, 24);
  const runId = text(source.runId, ID_LIMIT);
  const participants = Array.isArray(source.participants) ? source.participants.map(cleanRunParticipant).filter(Boolean) : [];
  const state = RUN_STATES.includes(source.state) ? source.state : null;
  const startedAt = text(source.startedAt, 40);
  if (!/^r\d+$/.test(handle) || !runId || participants.length !== 2 || !state || !Number.isFinite(Date.parse(startedAt))) return null;
  /** @type {any} */
  let plan = null;
  try {
    plan = runPlan.plan(source.plan);
  } catch {
    return null;
  }
  const endedAt = text(source.endedAt, 40);
  const outcome = RUN_OUTCOMES.includes(source.outcome) ? source.outcome : null;
  const pausedAt = text(source.pausedAt, 40);
  const pausedMs = Number.isInteger(source.pausedMs) && source.pausedMs >= 0 ? source.pausedMs : 0;
  return {
    handle,
    runId,
    participants,
    plan,
    state,
    outcome: state === 'ended' ? outcome : null,
    reason: text(source.reason, TEXT_LIMIT),
    startedAt,
    endedAt: state === 'ended' && Number.isFinite(Date.parse(endedAt)) ? endedAt : null,
    // A paused run keeps the time it has already spent paused, so resuming cannot lose it and the plan's clock
    // stays honest across a restart.
    pausedAt: state === 'paused' && Number.isFinite(Date.parse(pausedAt)) ? pausedAt : null,
    pausedMs,
    history: cleanRunHistory(source.history)
  };
}

module.exports = {
  RUN_LEDGER_LIMIT,
  RUN_HISTORY_LIMIT,
  RUN_STATES,
  RUN_OUTCOMES,
  cleanRun,
  cleanRunParticipant,
  cleanRunHistory
};
