// What a bulk account action would do, decided before anything is touched.
//
// The Account management tab can act on many accounts at once, and "Remove" across a selection is the
// most destructive control in the application. The rules that already govern the single-account buttons —
// an open session cannot be archived or removed — are restated here as one pure decision, so the IPC layer
// executes a plan it was handed and the tests can pin the rules without an Electron runtime.
//
// A plan is either refused with a reason that names the accounts at fault, or it lists exactly which
// accounts the action applies to and which were skipped because the action was already true of them.
//
// Pure module: no filesystem, no Electron. Enforced by test/architecture.test.cjs.

const ACTIONS = ['open', 'close', 'archive', 'delete'];
const MAX_SELECTION = 100;

/**
 * Validate the request itself: a known action and a non-empty, deduplicated list of accounts that all
 * still exist. Anything the dashboard could get wrong — a stale list, a forged id, a runaway selection —
 * is refused here rather than part-way through the work.
 * @param {unknown} input
 * @param {{id: string, name: string, archived?: boolean}[]} accounts
 * @returns {{action: 'open'|'close'|'archive'|'delete', ids: string[], accounts: any[]}}
 */
function selection(input, accounts) {
  const source = input && typeof input === 'object' ? input : {};
  const action = /** @type {'open'|'close'|'archive'|'delete'} */ (String(/** @type {any} */ (source).action || ''));
  if (!ACTIONS.includes(action)) throw new Error('Choose a supported bulk action.');
  const requested = Array.isArray(/** @type {any} */ (source).ids) ? /** @type {any} */ (source).ids : [];
  /** @type {string[]} */
  const ids = [];
  for (const value of requested) {
    if (typeof value !== 'string' || !value) continue;
    if (!ids.includes(value)) ids.push(value);
  }
  if (!ids.length) throw new Error('Select at least one account.');
  if (ids.length > MAX_SELECTION) throw new Error(`Select ${MAX_SELECTION} accounts or fewer at a time.`);
  const known = new Map((Array.isArray(accounts) ? accounts : []).map(account => [account.id, account]));
  if (ids.some(id => !known.has(id))) throw new Error('A selected account no longer exists. Reopen the list and try again.');
  return { action, ids, accounts: ids.map(id => /** @type {any} */ (known.get(id))) };
}

/**
 * The accounts an action would actually change, and the ones it would leave alone because they are
 * already in the requested state. A no-op is not an error: pressing Open on a list that is already open
 * should report that nothing needed doing, not fail.
 * @param {'open'|'close'|'archive'|'delete'} action
 * @param {{id: string, name: string}[]} accounts
 * @param {(account: {id: string, name: string}) => boolean} isOpen
 */
function plan(action, accounts, isOpen) {
  const names = accounts.map(account => account.name);
  const open = accounts.filter(isOpen);
  if (action === 'archive' || action === 'delete') {
    if (open.length) {
      const verb = action === 'archive' ? 'archiving' : 'removing';
      const noun = open.length === 1 ? 'this session' : 'these sessions';
      return { ok: /** @type {const} */ (false), error: `Close ${noun} before ${verb}: ${open.map(a => a.name).join(', ')}.` };
    }
    return { ok: /** @type {const} */ (true), ids: accounts.map(a => a.id), names, skipped: [] };
  }
  const wanted = action === 'open' ? accounts.filter(a => !isOpen(a)) : open;
  const skipped = accounts.filter(a => !wanted.includes(a)).map(a => a.name);
  return { ok: /** @type {const} */ (true), ids: wanted.map(a => a.id), names, skipped };
}

/**
 * The one sentence the confirmation dialog shows before an irreversible removal, naming exactly how many
 * accounts are destroyed and which ones.
 * @param {string[]} names
 */
function removalPrompt(names) {
  const shown = names.slice(0, 8).join(', ');
  const more = names.length > 8 ? `, and ${names.length - 8} more` : '';
  return {
    title: `Remove ${names.length} account${names.length === 1 ? '' : 's'} from Poolside?`,
    detail:
      `This permanently removes ${shown}${more} along with their isolated browser profiles, including cookies and saved ` +
      'session storage on this PC. Use Archive if you may want to restore them later.'
  };
}

module.exports = { ACTIONS, MAX_SELECTION, selection, plan, removalPrompt };
