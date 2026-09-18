// Crash and stall supervision for one session window.
//
// The FSM (session-fsm.cjs) says *what state* a session is in. This module decides *when a session
// has failed underneath us* and *how hard to try to bring it back*:
//
//  - `render-process-gone` — the renderer died (crash, OOM, killed). The page is gone.
//  - `unresponsive` — the renderer stopped answering. The user's own workaround for this was to
//    reload and jiggle the window, so a bounded automatic reload is the same action, done once and
//    with a ceiling rather than on a loop.
//  - `responsive` — it came back on its own, so the session returns to ready and the backoff budget
//    is credited.
//
// Recovery is bounded: exponential backoff with a cap, and a maximum number of attempts per
// failure streak. When the budget is exhausted the session stays `degraded` and the log says what
// to do, because an unbounded reload loop against a third-party site is worse than a dead window.
//
// Pure module: it never imports Electron. The window is treated as an event emitter and the reload
// mechanism is injected, which is what makes the whole policy unit testable. Enforced by
// test/architecture.test.cjs.

const {
  MAX_RECOVERY_ATTEMPTS,
  UNRESPONSIVE_GRACE_MS,
  createHealth,
  describeRendererGone,
  recoveryDelay
} = require('./recovery-policy.cjs');

/**
 * @param {object} deps
 * @param {string} deps.label human-readable account name
 * @param {{window: any}} deps.group
 * @param {import('./session-fsm.cjs').SessionFsm} deps.fsm
 * @param {import('./types.cjs').LogFn} deps.log
 * @param {() => void} deps.publish
 * @param {() => void} deps.recover mechanism: reload the session. Supplied by windows.cjs, which
 *   owns the game URL.
 * @param {{baseMs?: number, maxMs?: number, maxAttempts?: number, graceMs?: number}} [deps.policy]
 * @param {{setTimer?: Function, clearTimer?: Function, now?: () => number}} [deps.timers]
 */
function attachSupervision(deps) {
  const { label, group, fsm, log, publish, recover } = deps;
  const policy = deps.policy || {};
  const maxAttempts = policy.maxAttempts === undefined ? MAX_RECOVERY_ATTEMPTS : policy.maxAttempts;
  const graceMs = policy.graceMs === undefined ? UNRESPONSIVE_GRACE_MS : policy.graceMs;
  const setTimer = (deps.timers && deps.timers.setTimer) || setTimeout;
  const clearTimer = (deps.timers && deps.timers.clearTimer) || clearTimeout;
  const now = (deps.timers && deps.timers.now) || (() => Date.now());

  const wc = group.window.webContents;
  const health = createHealth();
  /** @type {any} */
  let recoveryTimer = null;
  /** @type {any} */
  let graceTimer = null;
  let disposed = false;
  let announcedExhaustion = false;

  /** @type {{name: string, handler: (...args: any[]) => void}[]} */
  const bound = [];

  function listen(name, handler) {
    wc.on(name, handler);
    bound.push({ name, handler });
  }

  function recordFailure(reason) {
    health.failures += 1;
    health.consecutive += 1;
    health.lastFailureAt = new Date(now()).toISOString();
    health.lastFailureReason = reason;
    publish();
  }

  /**
   * Bring the session back, or explain why we are not going to keep trying.
   * @param {string} reason
   */
  function fail(reason) {
    if (disposed || fsm.isTerminal()) return;
    recordFailure(reason);
    fsm.send('failed', reason);
    if (health.attempts >= maxAttempts) {
      health.exhausted = true;
      if (!announcedExhaustion) {
        announcedExhaustion = true;
        log(
          `${label}: giving up after ${health.attempts} recovery attempts (last: ${reason}). Close and reopen the window to retry.`,
          'warning'
        );
      }
      publish();
      return;
    }
    const delay = recoveryDelay(health.attempts, policy);
    health.attempts += 1;
    health.nextAttemptAt = new Date(now() + delay).toISOString();
    publish();
    log(`${label}: ${reason}. Recovering in ${Math.round(delay / 1000)}s (attempt ${health.attempts}/${maxAttempts}).`, 'warning');
    recoveryTimer = setTimer(attemptRecovery, delay);
  }

  function attemptRecovery() {
    recoveryTimer = null;
    if (disposed || fsm.isTerminal()) return;
    health.nextAttemptAt = null;
    log(`${label}: reloading to recover.`);
    fsm.send('recover');
    try {
      recover();
    } catch (error) {
      fail(`recovery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** A page that finished loading is evidence the session is alive: credit the budget back. */
  function creditRecovery() {
    health.consecutive = 0;
    health.attempts = 0;
    health.exhausted = false;
    announcedExhaustion = false;
    health.nextAttemptAt = null;
  }

  listen('render-process-gone', (_event, details) => fail(describeRendererGone(details)));

  listen('unresponsive', () => {
    if (disposed || fsm.isTerminal() || graceTimer !== null) return;
    // Give it a grace period before acting: a busy renderer is not a hung one.
    graceTimer = setTimer(() => {
      graceTimer = null;
      fail(`unresponsive for ${Math.round(graceMs / 1000)}s`);
    }, graceMs);
  });

  listen('responsive', () => {
    if (graceTimer !== null) {
      clearTimer(graceTimer);
      graceTimer = null;
    }
    if (disposed || fsm.isTerminal()) return;
    if (!fsm.isUnhealthy()) return;
    // It answered on its own. Only a degraded session is pulled back, and only to ready.
    health.recoveries += 1;
    creditRecovery();
    fsm.send('loaded');
    log(`${label}: the session responded again.`);
  });

  listen('did-finish-load', () => {
    creditRecovery();
    publish();
  });

  function dispose() {
    disposed = true;
    if (recoveryTimer !== null) clearTimer(recoveryTimer);
    if (graceTimer !== null) clearTimer(graceTimer);
    recoveryTimer = null;
    graceTimer = null;
    for (const { name, handler } of bound) wc.removeListener(name, handler);
    bound.length = 0;
  }

  return { health, dispose, fail };
}

module.exports = { attachSupervision };
