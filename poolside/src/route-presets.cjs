const { randomUUID } = require('node:crypto');
const { parseProxySpec, normaliseBypass } = require('./proxy.cjs');

/** How many failures a saved location keeps. Enough to see a pattern, small enough to read. */
const FAILURE_HISTORY = 3;
/** A stored reason is a sentence from the app, not a page: bounded so a document cannot grow a novel. */
const DETAIL_LIMIT = 160;

/**
 * What has been learned about a saved location by using it, kept flat on the record so it survives the same
 * round trip every other field does. `checks` counts attempts; `failures` keeps the last few reasons, because
 * "it failed once" and "it fails every time I open the second account" are different situations.
 */
function healthOf(source) {
  const preset = source && typeof source === 'object' ? source : {};
  const at = typeof preset.lastCheckedAt === 'string' && Number.isFinite(Date.parse(preset.lastCheckedAt)) ? preset.lastCheckedAt : null;
  const result = preset.lastResult === 'ok' || preset.lastResult === 'failed' ? preset.lastResult : null;
  if (!at || !result) return {};
  const failures = Array.isArray(preset.failures)
    ? preset.failures
        .filter(entry => entry && typeof entry.reason === 'string' && Number.isFinite(Date.parse(entry.at)))
        .slice(-FAILURE_HISTORY)
        .map(entry => ({ at: new Date(entry.at).toISOString(), reason: entry.reason.slice(0, DETAIL_LIMIT) }))
    : [];
  return {
    lastCheckedAt: at,
    lastResult: result,
    lastDetail: typeof preset.lastDetail === 'string' ? preset.lastDetail.slice(0, DETAIL_LIMIT) : '',
    checks: Number.isInteger(preset.checks) && preset.checks > 0 ? preset.checks : 1,
    failures
  };
}

/** Plain words for how long ago something happened. No clock maths the reader has to do. */
function ago(ms) {
  const value = Math.max(0, Math.round(ms));
  if (value < 45000) return 'just now';
  const minutes = Math.round(value / 60000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function valid(input) {
  if (!input || typeof input !== 'object') throw new Error('Route preset is invalid.');
  const name = String(input.name || '').trim();
  if (!name || name.length > 40) throw new Error('Use a route preset name between 1 and 40 characters.');
  const spec = String(input.spec || '').trim();
  // The dashboard is never handed a saved address with credentials in it: it shows `host:port · credentials set`.
  // If that label ever comes back as an address — a form pre-filled with what was on screen, a copy and paste —
  // the address it describes would be replaced by the description of it. Refusing the shape is cheap.
  if (spec.includes('credentials set'))
    throw new Error("That is Poolside's masked label rather than an address. Paste the address itself.");
  const parsed = parseProxySpec(spec);
  if (!parsed.ok) throw new Error(parsed.error);
  const bypass = normaliseBypass(input.bypass);
  if (!bypass.ok) throw new Error(bypass.error);
  return { name, enabled: input.enabled !== false, spec, bypass: bypass.value };
}
function decode(input) {
  if (!Array.isArray(input)) return [];
  const names = new Set();
  return input.flatMap(item => {
    try {
      const preset = valid(item);
      if (!/^[0-9a-f-]{36}$/i.test(item.id) || names.has(preset.name.toLowerCase())) return [];
      names.add(preset.name.toLowerCase());
      return [{ id: item.id, ...preset, ...healthOf(item) }];
    } catch {
      return [];
    }
  });
}
function create(input, existing) {
  const preset = valid(input);
  if (existing.some(item => item.name.toLowerCase() === preset.name.toLowerCase()))
    throw new Error('A route preset already uses that name.');
  return { id: randomUUID(), ...preset };
}

/**
 * What a check of this location found, recorded on the record.
 *
 * `ok` is the operator's own test answering, or a live session's exit address being read: both are the
 * application measuring the route rather than believing it. The outcome is kept, and so is the reader's own
 * wording — a reason that is not recorded is a reason nobody can act on later.
 * @param {any} preset @param {{at?: number, ok?: boolean, message?: string}} finding
 */
function recordCheck(preset, finding = {}) {
  const at = Number.isFinite(finding.at) ? new Date(Number(finding.at)).toISOString() : new Date().toISOString();
  const detail = String(finding.message || '').slice(0, DETAIL_LIMIT);
  const ok = finding.ok === true;
  const previous = healthOf(preset);
  const failures = ok
    ? previous.failures || []
    : [...(previous.failures || []), { at, reason: detail || 'no reason was reported' }].slice(-FAILURE_HISTORY);
  return {
    ...preset,
    lastCheckedAt: at,
    lastResult: ok ? 'ok' : 'failed',
    lastDetail: detail,
    checks: (Number.isInteger(previous.checks) ? previous.checks : 0) + 1,
    failures
  };
}

/**
 * The same record, in a sentence the Settings list can show without doing any arithmetic of its own.
 * @param {any} preset @param {number} [now]
 */
function describeHealth(preset, now = Date.now()) {
  const health = healthOf(preset);
  if (!health.lastCheckedAt) return 'Not checked from here yet.';
  const when = ago(now - Date.parse(health.lastCheckedAt));
  const detail = health.lastDetail ? ` — ${health.lastDetail}` : '';
  if (health.lastResult === 'ok') return `Worked ${when}${detail}`;
  const repeated = health.failures.length > 1 ? `, ${health.failures.length} times in a row` : '';
  return `Did not work ${when}${detail}${repeated}`;
}

/**
 * One saved location, edited.
 *
 * Two rules are worth stating, because both are what the operator would have got wrong by hand:
 *
 *   * **A blank address means "leave the saved one alone", not "erase it".** The page never holds the real
 *     address of a location that has credentials — it holds `host:port · credentials set` — so the edit form
 *     shows the name and the settings and leaves the address field empty with a note. Clearing the field must not
 *     be able to throw away the address the operator pasted once and cannot read back.
 *   * **The id and the account assignments are not the form's to change.** They are carried across from the
 *     current record rather than taken from the input, so an edit cannot re-point a location at another slot.
 *
 * @param {any} input @param {any[]} existing
 */
function update(input, existing) {
  if (!input || typeof input !== 'object') throw new Error('Route preset is invalid.');
  const id = typeof input.id === 'string' ? input.id : '';
  const current = existing.find(item => item.id === id);
  if (!current) throw new Error('Route preset not found.');
  const typed = typeof input.spec === 'string' ? input.spec.trim() : '';
  const preset = valid({ ...current, ...input, spec: typed || current.spec });
  if (existing.some(item => item.id !== id && item.name.toLowerCase() === preset.name.toLowerCase()))
    throw new Error('A route preset already uses that name.');
  return { ...current, ...preset };
}

module.exports = { valid, decode, create, update, recordCheck, describeHealth, healthOf, FAILURE_HISTORY, DETAIL_LIMIT };
