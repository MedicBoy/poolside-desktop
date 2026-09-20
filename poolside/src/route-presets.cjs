const { randomUUID } = require('node:crypto');
const { parseProxySpec, normaliseBypass } = require('./proxy.cjs');
function valid(input) {
  if (!input || typeof input !== 'object') throw new Error('Route preset is invalid.');
  const name = String(input.name || '').trim();
  if (!name || name.length > 40) throw new Error('Use a route preset name between 1 and 40 characters.');
  const spec = String(input.spec || '').trim();
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
module.exports = { valid, decode, create };
