// What the two accounts of a match are configured to look like, said next to the pairing verdict.
//
// The pairing verdict answers "did the evidence show they met". When it says *agreement, not proof* — the case the
// operator actually hit — the next question is why two sessions that agreed on a table did not meet. This module
// cannot answer that, and does not pretend to. What it can do is state the two configuration facts that make a
// match look like one machine twice:
//
//   * neither account has an identity of its own, so both sessions are configured to report the same values;
//   * the two accounts are pointed at the same saved location, or one of them is pointed at one and the other is
//     left to whatever the workspace says, so there is no reason to expect two exits.
//
// It reports configuration, never observation: the values a session actually reports come from the Sessions view's
// comparison, which reads the live pages. Saying "these two look alike" from stored settings would be a claim
// without evidence, and this module is careful to say only what the settings are.
//
// Pure: no Electron, no fs. It takes the workspace's accounts and saved locations and nothing else.

/**
 * @param {{participants?: {id?: string, name?: string}[], accounts?: any[], routePresets?: any[]}|null} [input]
 * @returns {{code: string, text: string}[]}
 */
function notes(input) {
  // The whole argument may be absent, and every part of it may be junk: this runs while building a snapshot, and a
  // snapshot that throws takes the dashboard with it.
  const { participants = [], accounts = [], routePresets = [] } = input && typeof input === 'object' ? input : {};
  const list = (Array.isArray(participants) ? participants : []).filter(entry => entry && typeof entry === 'object');
  if (list.length < 2) return [];
  const accountIn = id => (Array.isArray(accounts) ? accounts : []).find(account => account && account.id === id) || null;
  const presetIn = id => (Array.isArray(routePresets) ? routePresets : []).find(preset => preset && preset.id === id) || null;
  const described = list.map(entry => {
    const account = accountIn(entry.id);
    const name = typeof entry.name === 'string' && entry.name ? entry.name : 'An account';
    const preset = account ? presetIn(account.routePresetId) : null;
    return {
      name,
      // "Has an identity of its own" means the account carries identity settings, not that the browser accepts
      // them: a refused value is reported on the account row by the field it belongs to, and is not re-judged here.
      ownIdentity: Boolean(account && account.identity && Object.keys(account.identity).length),
      location: preset && typeof preset.name === 'string' ? preset.name : null
    };
  });
  const out = [];
  if (!described.some(entry => entry.ownIdentity))
    out.push({
      code: 'no-identity',
      text: `Neither ${described.map(entry => entry.name).join(' nor ')} has an identity of its own, so both sessions are configured to report the same values. The Sessions view can compare what they actually report.`
    });
  const located = described.filter(entry => entry.location);
  if (located.length === described.length && new Set(located.map(entry => entry.location)).size === 1)
    out.push({
      code: 'same-location',
      text: `Both accounts use ${located[0].location}, so they leave from the same address. Two different exits need two saved locations.`
    });
  // Only when *some* of them are located: two different saved locations are two exits, which is the situation this
  // module exists to stop warning about.
  else if (located.length && located.length < described.length) {
    const withLocation = located.map(entry => `${entry.name} (${entry.location})`).join(' and ');
    const without = described.filter(entry => !entry.location).map(entry => entry.name);
    out.push({
      code: 'mixed-location',
      text: `${withLocation} ${located.length === 1 ? 'uses' : 'use'} a saved location, and ${without.join(' and ')} ${
        without.length === 1 ? 'uses' : 'use'
      } whatever is set for the workspace — so these two may leave from the same address.`
    });
  }
  return out;
}

module.exports = { notes };
