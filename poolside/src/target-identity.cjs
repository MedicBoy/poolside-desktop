// The target half of a session footprint: the CDP overrides that make a *live page* claim a configured
// identity, and the deadline that stops a stuck debugger holding a session open.
//
// Split from footprint.cjs so that "what may this target claim" is separate from "apply and report the
// session-level footprint", and so both modules stay under the size ceiling.

const { cdpOverrides, needsTargetOverrides } = require('./identity.cjs');
const { messageOf } = require('./errors.cjs');

const DEBUGGER_PROTOCOL_VERSION = '1.3';
const COMMAND_DEADLINE_MS = 5000;

/**
 * CDP has no built-in deadline. A command that never answers would otherwise hold a session open
 * forever with no window to close, so every command is raced against one and a stuck debugger is
 * *reported* instead of hanging. (Measured behaviour: all four emulation commands answer immediately
 * against a live target — this is a guard, not a workaround.)
 * @template T
 * @param {Promise<T>} promise @param {number} ms @param {string} label
 * @returns {Promise<T>}
 */
function withDeadline(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} did not answer within ${ms} ms`)), ms);
      if (typeof timer.unref === 'function') timer.unref();
    })
  ]);
}

/**
 * The target-level half, over CDP. Returns the commands that were accepted; the debugger stays attached,
 * because detaching is what clears these overrides.
 *
 * Each override is applied on its own. One refused value must not take the others with it — a browser that
 * dislikes a time zone should leave the language, window size and colour scheme in place — and what is refused
 * is reported by the field it belongs to, with the value, because "Target overrides failed after 1 of 5" told
 * the operator nothing about which control to clear.
 *
 * Trade-off, stated plainly: an attached debugger means DevTools cannot be opened on that window and the
 * target is inspectable. That is why this is opt-in per account rather than always on.
 * @param {import('electron').WebContents} webContents
 * @param {{identity: import('./identity.cjs').ResolvedIdentity}} footprint
 * @param {import('./types.cjs').LogFn} log
 */
async function applyTargetFootprint(webContents, footprint, log) {
  const commands = cdpOverrides(footprint.identity);
  if (!commands.length) return { applied: [], attached: false, skipped: 'no target-level overrides configured' };
  if (webContents.isDestroyed()) return { applied: [], attached: false, error: 'the window closed before its overrides were applied' };
  const debug = webContents.debugger;
  // Declared outside the try so the catch can report how far it got.
  /** @type {string[]} */
  const applied = [];
  /** @type {{field: string, value: unknown, error: string}[]} */
  const refused = [];
  try {
    // A window that has never navigated has no renderer. CDP commands sent to it are *accepted* but their
    // replies never arrive, so the awaits below would hang forever with no window to close (measured:
    // setLocaleOverride applied correctly and still never answered). Loading about:blank first gives the
    // target a renderer, and the overrides survive the real navigation that follows — which is also what
    // puts them in place before the page's first script runs.
    if (needsTargetOverrides(footprint.identity) && !webContents.getURL()) {
      await webContents.loadURL('about:blank');
    }
    if (!debug.isAttached()) debug.attach(DEBUGGER_PROTOCOL_VERSION);
    for (const command of commands) {
      try {
        await withDeadline(debug.sendCommand(command.method, command.params), COMMAND_DEADLINE_MS, command.method);
        applied.push(command.field);
      } catch (error) {
        // Reported by field and value, and the rest of the identity still applies.
        refused.push({ field: command.field, value: command.value, error: messageOf(error) });
        log(
          `${command.field} "${String(command.value)}" was refused by the browser (${messageOf(error)}). The rest of this session's identity still applies; clear or correct that field in Settings, or in this account's preferences.`,
          'warning'
        );
      }
    }
    log(`Session footprint: applied ${applied.join(', ')} to the live page.`);
    return { applied, refused, attached: true };
  } catch (error) {
    // A refused override must not stop the session opening: report it and carry on. The commands that
    // did land are kept — reporting an empty list would hide a partially applied identity.
    log(`Target overrides failed after ${applied.length} of ${commands.length}: ${messageOf(error)}`, 'warning');
    return { applied, refused, attached: debug.isAttached(), error: messageOf(error) };
  }
}

module.exports = { applyTargetFootprint, withDeadline };
