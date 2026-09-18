// The session state machine.
//
// Replaces the `status` string that three modules used to assign directly. Two things it fixes:
//
//  1. **Transitions are declared, not implied.** An event that does not apply to the current state
//     is refused and logged instead of silently overwriting state, so "the second account never
//     opened" stops being invisible.
//  2. **Timeouts are owned by the machine.** `launching` and `loading` each carry a deadline; the
//     machine fires `stalled` when one expires. Previously the deadlines were ad-hoc call sites,
//     which is how a session could sit in `loading` forever and still look fine in the dashboard.
//
// Pure module: no filesystem, no Electron, no clock of its own. Timers and the clock are injectable
// so behaviour under expiry is deterministic in tests. Enforced by test/architecture.test.cjs.

/** @typedef {'idle'|'launching'|'loading'|'ready'|'degraded'|'closing'|'closed'} SessionState */

const STATES = /** @type {SessionState[]} */ (['idle', 'launching', 'loading', 'ready', 'degraded', 'closing', 'closed']);

/**
 * Deadlines per transitional state, in milliseconds. A state absent from this map has no deadline.
 * `launching` covers window creation and profile preparation; `loading` covers the page load.
 */
const DEFAULT_TIMEOUTS = { launching: 30000, loading: 45000 };

/**
 * Event → next state, per state. `closed` is reachable from everywhere except itself, because a
 * window can be torn down at any moment and pretending otherwise would drop the fact.
 * @type {Record<SessionState, Record<string, SessionState>>}
 */
const TRANSITIONS = {
  idle: { launch: 'launching', closed: 'closed' },
  launching: { load: 'loading', loaded: 'ready', failed: 'degraded', stalled: 'degraded', close: 'closing', closed: 'closed' },
  loading: { loaded: 'ready', failed: 'degraded', stalled: 'degraded', close: 'closing', closed: 'closed' },
  ready: { reload: 'loading', failed: 'degraded', stalled: 'degraded', close: 'closing', closed: 'closed' },
  degraded: {
    recover: 'loading',
    reload: 'loading',
    loaded: 'ready',
    failed: 'degraded',
    stalled: 'degraded',
    close: 'closing',
    closed: 'closed'
  },
  closing: { closed: 'closed', failed: 'degraded' },
  closed: {}
};

/** States that mean "still getting there", for UI that must not offer actions yet. */
const BUSY_STATES = /** @type {SessionState[]} */ (['launching', 'loading', 'closing']);
/** States that need attention. */
const UNHEALTHY_STATES = /** @type {SessionState[]} */ (['degraded']);
const HISTORY_LIMIT = 50;

/**
 * @param {object} [options]
 * @param {string} [options.id]
 * @param {Record<string, number>} [options.timeouts]
 * @param {(message: string, kind?: 'info'|'warning') => void} [options.log]
 * @param {(transition: {from: SessionState, to: SessionState, event: string, reason: string|null, state: SessionState}) => void} [options.onTransition]
 * @param {() => number} [options.now]
 * @param {(fn: () => void, ms: number) => any} [options.setTimer]
 * @param {(timer: any) => void} [options.clearTimer]
 */
function createSessionFsm(options = {}) {
  const id = options.id || 'session';
  const timeouts = options.timeouts || DEFAULT_TIMEOUTS;
  const log = options.log || (() => {});
  const onTransition = options.onTransition || (() => {});
  const now = options.now || (() => Date.now());
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;

  /** @type {SessionState} */
  let state = 'idle';
  /** @type {any} */
  let deadline = null;
  /** @type {{at: string, from: SessionState, to: SessionState, event: string, reason: string|null}[]} */
  const history = [];
  /** @type {string|null} */
  let reason = null;

  function disarm() {
    if (deadline !== null) clearTimer(deadline);
    deadline = null;
  }

  /** Arm the deadline for the state we just entered, if it has one. */
  function arm() {
    disarm();
    const ms = timeouts[state];
    if (!ms) return;
    deadline = setTimer(() => {
      deadline = null;
      send('stalled', `no progress within ${ms} ms`);
    }, ms);
  }

  /**
   * @param {SessionState} next
   * @param {string} event
   * @param {string|null} why
   */
  function move(next, event, why) {
    const previous = state;
    state = next;
    reason = why;
    history.push({ at: new Date(now()).toISOString(), from: previous, to: next, event, reason: why });
    if (history.length > HISTORY_LIMIT) history.shift();
    arm();
    onTransition({ from: previous, to: next, event, reason: why, state });
  }

  /**
   * Whether an event would move the machine from its current state.
   * @param {string} event
   */
  function canSend(event) {
    return Boolean(TRANSITIONS[state] && TRANSITIONS[state][event]);
  }

  /**
   * Apply an event. Returns false, and changes nothing, when the event does not apply.
   * A refused event is logged because it is usually a real signal (a late `did-finish-load` after a
   * window closed, a second `launch` for a session already launching).
   * @param {string} event
   * @param {string} [why]
   */
  function send(event, why) {
    if (state === 'closed') return false;
    if (!canSend(event)) {
      log(`${id}: '${event}' does not apply in state '${state}'; ignored.`, 'warning');
      return false;
    }
    move(TRANSITIONS[state][event], event, why === undefined ? null : why);
    return true;
  }

  /** Release the pending deadline. Call when the window is gone. */
  function dispose() {
    disarm();
  }

  return {
    send,
    canSend,
    dispose,
    /** @returns {SessionState} */
    get state() {
      return state;
    },
    /** Why the machine last moved, for the dashboard. */
    get reason() {
      return reason;
    },
    /** Transition history, oldest first. Feeds the M4 timeline. */
    history: () => history.slice(),
    isBusy: () => BUSY_STATES.includes(state),
    isUnhealthy: () => UNHEALTHY_STATES.includes(state),
    isTerminal: () => state === 'closed'
  };
}

module.exports = { createSessionFsm, STATES, TRANSITIONS, DEFAULT_TIMEOUTS, BUSY_STATES, UNHEALTHY_STATES, HISTORY_LIMIT };

/** @typedef {ReturnType<typeof createSessionFsm>} SessionFsm */
