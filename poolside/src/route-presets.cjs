const { randomUUID } = require('node:crypto');
const { parseProxySpec, normaliseBypass } = require('./proxy.cjs');
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
      return [{ id: item.id, ...preset }];
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

module.exports = { valid, decode, create, update };
