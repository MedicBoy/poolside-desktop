// Recovery policy: how long to wait, how many times to try, and how to describe a failure.
//
// Split out of supervision.cjs so the policy is a value you can read and test on its own, and so
// the supervisor stays inside the module-size ceiling.
//
// Pure module: no filesystem, no Electron, no timers of its own. Enforced by
// test/architecture.test.cjs.

const RECOVERY_BASE_MS = 1500;
const RECOVERY_MAX_MS = 30000;
const MAX_RECOVERY_ATTEMPTS = 3;
const UNRESPONSIVE_GRACE_MS = 8000;

/** Reasons Electron reports for a dead renderer, spelled out so an unknown one is visible. */
const RENDERER_REASONS = ['crashed', 'oom', 'killed', 'launch-failed', 'integrity-failure'];

/**
 * Backoff for attempt `n` (0-based): base, double, double, capped. Deterministic rather than
 * jittered, because a third-party site is not a thundering herd and predictability is worth more
 * here than spread.
 * @param {number} attempt
 * @param {{baseMs?: number, maxMs?: number}} [policy]
 */
function recoveryDelay(attempt, policy = {}) {
  const base = policy.baseMs === undefined ? RECOVERY_BASE_MS : policy.baseMs;
  const max = policy.maxMs === undefined ? RECOVERY_MAX_MS : policy.maxMs;
  const step = Math.max(0, Math.floor(Number(attempt) || 0));
  return Math.min(base * 2 ** step, max);
}

/** The per-session health record, shown in the dashboard on a degraded card. */
function createHealth() {
  return {
    failures: 0,
    recoveries: 0,
    consecutive: 0,
    attempts: 0,
    exhausted: false,
    lastFailureAt: /** @type {string|null} */ (null),
    lastFailureReason: /** @type {string|null} */ (null),
    nextAttemptAt: /** @type {string|null} */ (null)
  };
}

/**
 * Turn Electron's `render-process-gone` details into a reason a user can read.
 * @param {{reason?: string, exitCode?: number}|null|undefined} details
 */
function describeRendererGone(details) {
  const why = details && details.reason ? details.reason : 'unknown';
  const known = RENDERER_REASONS.includes(why) ? why : 'unknown';
  const exitCode = details && details.exitCode !== undefined ? ` (exit ${details.exitCode})` : '';
  return `renderer gone: ${known}${exitCode}`;
}

module.exports = {
  recoveryDelay,
  createHealth,
  describeRendererGone,
  RECOVERY_BASE_MS,
  RECOVERY_MAX_MS,
  MAX_RECOVERY_ATTEMPTS,
  UNRESPONSIVE_GRACE_MS,
  RENDERER_REASONS
};
