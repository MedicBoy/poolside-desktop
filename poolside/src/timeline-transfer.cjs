// What may leave the machine.
//
// Split from `timeline-engine.cjs`, which reads history, because these are different questions: the engine
// answers "what happened, in what order", and this module answers "which parts of that may be written to a file
// somebody else might read". ADR-0010 commits the diagnostics bundle to carrying no account names, and the rules
// for that belong next to the code that enforces them rather than in a policy note.
//
// Pure: no Electron, no fs. Enforced by test/architecture.test.cjs.

const { compile } = require('./timeline-engine.cjs');
const { index, summarise } = require('./timeline-query.cjs');

/**
 * Remove what must never leave the machine (ADR-0010): account names, and any account name embedded in an
 * activity message.
 *
 * Account *identifiers* become a stable `account N` reference rather than being kept, because the point of a
 * redacted stream is that somebody else can read it without learning who the user plays as. Messages are
 * rewritten with `split`/`join` rather than a pattern: an account name is user input and can contain any
 * character a regex would treat as syntax — `(`, `[`, `*`, `+` — which is why this is a test as well as a rule.
 *
 * `accounts` is **required in spirit and defaulted only for convenience**: the names to sweep have to come from
 * the caller's account list, not from the entries. An activity entry is not per-account, so an account whose
 * session is closed appears in the feed by name with no entry that carries it — inferring the names from the
 * entries left exactly those names in the payload, which the desktop suite's IPC guard caught.
 *
 * @param {any[]} entries
 * @param {{id?: unknown, name?: unknown}[]} [accounts]
 * @returns {{entries: any[], nameMap: Record<string, string>}}
 */
function redact(entries, accounts = []) {
  const stream = Array.isArray(entries) ? entries : [];
  /** @type {Record<string, string>} */
  const nameMap = {};
  /** @type {Record<string, string>} */
  const idMap = {};
  let next = 1;
  /** @param {unknown} id @param {unknown} name */
  const assign = (id, name) => {
    const key = String(id);
    if (!idMap[key]) {
      idMap[key] = `account ${next}`;
      next += 1;
    }
    // The placeholder *is* the identifier's reference — prefixing it again produced "account account 1".
    if (typeof name === 'string' && name && !nameMap[name]) nameMap[name] = idMap[key];
  };
  for (const account of Array.isArray(accounts) ? accounts : []) {
    if (account && typeof account === 'object') assign(account.id, account.name);
  }
  for (const entry of stream) if (entry.accountId) assign(entry.accountId, entry.accountName);
  const rewritten = stream.map(entry => {
    let message = entry.message;
    if (message) {
      for (const [name, placeholder] of Object.entries(nameMap)) {
        if (!name) continue;
        message = message.split(name).join(placeholder);
      }
    }
    return {
      ...entry,
      accountId: entry.accountId ? idMap[entry.accountId] : null,
      accountName: null,
      message
    };
  });
  return { entries: rewritten, nameMap };
}

/**
 * The dashboard-ready view: entries, counts, and the *sizes* of the index rather than the index itself, because
 * a `Map` does not survive a structured clone across IPC and shipping one silently becomes an empty object.
 *
 * @param {{sessions?: any[], events?: any[], limit?: number}} input
 * @param {{redact?: boolean}} [options]
 */
function view(input, options = {}) {
  const compiled = compile(input);
  const indexed = index(compiled);
  return {
    entries: options.redact ? redact(compiled).entries : compiled,
    summary: summarise(compiled),
    index: {
      accounts: indexed.byAccount.size,
      events: indexed.byEvent.size,
      transitions: indexed.byTransition.size
    },
    redacted: Boolean(options.redact)
  };
}

module.exports = { redact, view };
