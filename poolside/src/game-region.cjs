// Conservative viewport locator. Ambiguous/missing surfaces require user attention.
const GAME_REGION_PROBE = `(() => {
  const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  if ([...document.querySelectorAll('input[type="password"], dialog[open], [role="dialog"]')].some(visible)) return null;
  const candidates = [...document.querySelectorAll('canvas,iframe')].filter(visible).map(el => el.getBoundingClientRect()).filter(r => r.width >= 280 && r.height >= 180 && r.width/r.height >= 1.3 && r.width/r.height <= 1.8 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight);
  if (candidates.length !== 1) return null;
  const r = candidates[0];
  return { x: r.x, y: r.y, width: r.width, height: r.height };
})()`;
module.exports = { GAME_REGION_PROBE };
