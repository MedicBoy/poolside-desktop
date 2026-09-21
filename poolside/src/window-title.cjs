// One session window's title.
//
// It carries the address that session last reported, because somebody looking at a game window needs to see
// which exit it is using without switching to the dashboard. The title is the app's to set — the page's own
// title is refused — so the wording lives in one place, used by the guard that keeps the page title out and
// by the check that reads the address.
//
// Pure: a name and an address in, a title out.

/**
 * @param {unknown} name @param {unknown} ip
 * @returns {string}
 */
function windowTitleFor(name, ip) {
  const account = String(name === undefined || name === null || name === '' ? 'Account' : name);
  return typeof ip === 'string' && ip ? `Poolside · ${account} · ${ip}` : `Poolside · ${account}`;
}

module.exports = { windowTitleFor };
