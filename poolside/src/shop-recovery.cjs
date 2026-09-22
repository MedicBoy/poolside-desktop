// The shop auto-return: recognise the shop, wait for the headings to settle, then navigate back once per opening.
const SHOP_DELAY_MS = 5000;
function officialPage(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ['8ballpool.com', 'www.8ballpool.com'].includes(u.hostname);
  } catch {
    return false;
  }
}
// Read only visible page content; never inspect login values or cookies.
const SHOP_PROBE = `(() => {
  const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
  if ([...document.querySelectorAll('input[type="password"], [role="dialog"], dialog[open]')].some(visible)) return false;
  if ([...document.querySelectorAll('canvas, iframe')].some(el => visible(el) && el.getBoundingClientRect().width > 300 && el.getBoundingClientRect().height > 250)) return false;
  const text = (document.body?.innerText || '').slice(0, 80000);
  return /WEB SHOP EXCLUSIVE/i.test(text) && /FEATURED/i.test(text) && /(?:Weekly Deals|Daily Free Cue Piece)/i.test(text);
})()`;
class ShopReturnGate {
  constructor(delayMs = SHOP_DELAY_MS) {
    this.delayMs = delayMs;
    this.since = null;
    this.url = null;
    this.used = false;
  }
  reset() {
    this.since = null;
    this.url = null;
  }
  observe(url, shop, now) {
    if (this.used) return false;
    if (!officialPage(url) || !shop) {
      this.reset();
      return false;
    }
    if (this.url !== url || this.since === null) {
      this.since = now;
      this.url = url;
      return false;
    }
    if (now - this.since < this.delayMs) return false;
    this.used = true;
    return true;
  }
}
module.exports = { SHOP_PROBE, ShopReturnGate, officialPage };
