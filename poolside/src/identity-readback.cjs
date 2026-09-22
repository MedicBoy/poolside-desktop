// What each open session reports about itself, side by side.
//
// The question this answers is the one the operator actually has: when two profiles are loaded, do they look like
// two machines or one machine twice? Everything the application *applies* to a session is already configured per
// account; what was missing was seeing what came back. So this reads the values the page itself can read, and
// puts them next to each other.
//
// Two things it deliberately does not do. It **changes nothing** — every value here is a read, and a session that
// reports a value the operator did not choose is a fact to look at, not something to be quietly corrected. And it
// **claims nothing about a website**: this is what the browser reports to this page, on this machine, now. Two
// sessions differing here does not mean no site could tell them apart, and the wording says so.
//
// Pure: the caller supplies what each session read. No Electron, no page, no clock.

/**
 * The comparison, declared once.
 *
 * `read` is the property name on the object the page returns; `label` is what the operator sees. Processor cores
 * and device memory are included because they are two of the easiest things for a page to read and two of the
 * hardest to make vary honestly — seeing that both sessions report the same 8 cores is worth knowing even though
 * this application does not change them.
 */
const FIELDS = [
  { key: 'userAgent', label: 'Browser user agent' },
  { key: 'language', label: 'Language' },
  { key: 'languages', label: 'Accepted languages' },
  { key: 'timeZone', label: 'Time zone' },
  { key: 'locale', label: 'Locale' },
  { key: 'viewport', label: 'Window viewport' },
  { key: 'screen', label: 'Screen size' },
  { key: 'colorScheme', label: 'Preferred colour scheme' },
  { key: 'cores', label: 'Reported processor cores' },
  { key: 'memory', label: 'Reported device memory' }
];

/**
 * Read the properties above from inside a page. One expression, evaluated in the session's own context, so the
 * values are what that session sees rather than what the application believes it configured.
 *
 * Every read is wrapped: a page that has no `navigator.storage`, or a property that is absent, produces
 * `not reported` rather than an exception that would fail the whole comparison.
 */
const SCRIPT = `(() => {
  const say = value => value === undefined || value === null || value === '' ? 'not reported' : String(value);
  try {
    return {
      userAgent: say(navigator.userAgent),
      language: say(navigator.language),
      languages: say((navigator.languages || []).join(', ')),
      timeZone: say(Intl.DateTimeFormat().resolvedOptions().timeZone),
      locale: say(Intl.DateTimeFormat().resolvedOptions().locale),
      viewport: say(window.innerWidth + ' x ' + window.innerHeight),
      screen: say(screen.width + ' x ' + screen.height),
      colorScheme: say(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
      cores: say(navigator.hardwareConcurrency),
      memory: say(navigator.deviceMemory)
    };
  } catch (error) {
    return { failed: String(error && error.message ? error.message : error) };
  }
})()`;

/** Long values are cut for the table, with a marker, rather than pushing the columns off the page. */
const VALUE_LIMIT = 120;

/** @param {unknown} value */
function valueOf(value) {
  if (value === undefined || value === null || value === '') return 'not reported';
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > VALUE_LIMIT ? `${text.slice(0, VALUE_LIMIT - 1)}…` : text;
}

/**
 * A value that can actually be compared.
 *
 * "not reported" is not a value two sessions share: a property that neither page has (device memory is the usual
 * one) says nothing about whether they look alike, and counting it as a match would let two sessions with nothing
 * in common be described as one machine. The same goes for a session that could not be read at all.
 * @param {string} value
 */
function comparableValue(value) {
  return value !== 'not reported' && value !== 'could not be read';
}

/**
 * One row per field, one column per session.
 *
 * `same` is an exact string comparison of what each session reported. It is not a similarity score and it is not
 * a guess: the same string is the same string, and anything else is reported as different even when the
 * difference is one character.
 * The parameter is deliberately typed loosely: this is the defensive edge of the feature, and every junk value
 * that reaches it has to produce a table rather than an exception.
 * @param {any} sessions
 */
function compare(sessions) {
  const list = (Array.isArray(sessions) ? sessions : []).filter(session => session && typeof session === 'object');
  const rows = FIELDS.map(field => {
    const values = list.map(session => ({
      id: String(session.id ?? ''),
      name: String(session.name ?? 'session'),
      value: session.read && !session.read.failed ? valueOf(session.read[field.key]) : 'could not be read'
    }));
    const usable = values.filter(entry => comparableValue(entry.value));
    const first = usable.length ? usable[0].value : null;
    return {
      key: field.key,
      label: field.label,
      values,
      comparable: usable.length > 1,
      same: usable.length > 1 && usable.every(entry => entry.value === first)
    };
  });
  const comparable = rows.filter(row => row.comparable);
  const shared = comparable.filter(row => row.same);
  const failed = list.filter(session => !session.read || session.read.failed);
  return {
    sessions: list.map(session => ({ id: String(session.id ?? ''), name: String(session.name ?? 'session') })),
    rows,
    compared: comparable.length,
    readable: list.length - failed.length,
    sharedFields: shared.map(row => row.label),
    shared: shared.length,
    different: comparable.length - shared.length,
    unreadable: failed.map(session => String(session.name ?? 'session')),
    verdict: verdictFor(list.length, list.length - failed.length, comparable.length, shared)
  };
}

/**
 * The sentence above the table: what this comparison amounts to, and what it does not. Four situations that are
 * easy to confuse, and each gets its own sentence: not enough sessions, no session answered, nothing comparable
 * was reported, and an actual comparison.
 */
function verdictFor(count, readable, compared, shared) {
  if (count < 2) return 'Open two sessions and compare them: one session cannot be compared with itself.';
  if (readable < 2) return 'Neither session answered, so there is nothing to compare yet.';
  if (!compared) return 'Both sessions answered, and neither reported anything on this list, so there is nothing to compare yet.';
  if (shared.length === 0)
    return 'Every field compared is different between these sessions. That is what separate identities are for, and it is not a guarantee that a website treats them as different machines.';
  if (shared.length === compared)
    return `These sessions report the same value for all ${compared} fields compared — as far as this list goes, they look like one machine. Give one of them its own identity in Settings.`;
  return `${shared.length} of ${compared} fields are the same on both sessions: ${shared.map(row => row.label).join(', ')}. The rest differ.`;
}

module.exports = { FIELDS, SCRIPT, compare, valueOf, verdictFor, comparableValue, VALUE_LIMIT };
