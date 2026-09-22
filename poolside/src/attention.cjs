// Everything that needs the operator's attention, gathered in one place.
//
// Every problem this program has shown the operator today was, in the end, a *fact it already had* that was
// only visible on the panel they were not looking at: a workspace that could not be saved, a browser that
// refused an identity value, a session that failed to load, a route that is not in use, a match in progress
// with nothing open behind it. This module is the list. It derives nothing new — it reads the snapshot the
// dashboard already has and says what is wrong, in the operator's terms, with the control that fixes it.
//
// Pure: no Electron, no fs.

/**
 * One item. `level` decides how loudly it is drawn; `detail` says what is wrong; `action` says what to do.
 * @param {'warning'|'info'} level @param {string} code @param {string} title @param {string} detail @param {string} action
 */
function item(level, code, title, detail, action) {
  return { level, code, title, detail, action };
}

/** What one account needs, if anything. */
function accountItems(account) {
  const items = [];
  const name = account.name;
  if (account.status === 'failed' && account.statusReason)
    items.push(
      item(
        'warning',
        'session-failed',
        `${name} did not load`,
        account.statusReason,
        `Open ${name} again, and check the address it is set to leave by.`
      )
    );
  if (account.status === 'degraded' && account.statusReason)
    items.push(
      item(
        'warning',
        'session-degraded',
        `${name} needs attention`,
        account.statusReason,
        `Reload that page, or close and open ${name} again.`
      )
    );
  for (const refused of account.footprint?.refused || [])
    items.push(
      item(
        'warning',
        'identity-refused',
        `${name}: the browser refused a setting`,
        `${refused.field} "${refused.value}" was refused (${refused.error}). The rest of that session's identity still applies.`,
        `Clear or correct ${refused.field} in Settings, or in ${name}'s account preferences.`
      )
    );
  if (account.footprint?.verified && account.footprint.verified.ok === true && account.footprint.verified.matches === false)
    items.push(
      item(
        'warning',
        'route-not-in-use',
        `${name} is not using its configured route`,
        `The session reports ${account.footprint.verified.route.label} instead.`,
        `Check the address in Settings, or clear ${name}'s location to use the workspace default.`
      )
    );
  if (account.profile?.overQuota === true)
    items.push(
      item(
        'info',
        'storage-over-ceiling',
        `${name} is over its storage ceiling`,
        'That ceiling is measured and reported, not enforced by Chromium.',
        'Nothing to do unless you want to delete that profile and sign in again.'
      )
    );
  if (account.screenAttention && account.screenAttention.message)
    items.push(item('info', 'screen-attention', `${name}: the screen changed`, account.screenAttention.message, 'Look at that window.'));
  return items;
}

/**
 * The whole list, most serious first: a workspace that cannot be saved outranks a session that needs a reload.
 * @param {{accounts?: any[], readOnly?: boolean, matches?: any}} input
 */
function items({ accounts = [], readOnly = false, matches = null } = {}) {
  const list = [];
  if (readOnly)
    list.push(
      item(
        'warning',
        'workspace-read-only',
        'Nothing can be saved',
        'The workspace file could not be read, so Poolside has not overwritten anything and is refusing to write.',
        'Settings → Recover earlier data, and restore the copy that holds what you expect.'
      )
    );
  for (const account of accounts) list.push(...accountItems(account));
  for (const match of (matches && matches.active) || []) {
    const participants = match.participants || [];
    if (participants.length && participants.every(participant => participant.open !== true))
      list.push(
        item(
          'warning',
          'match-without-session',
          `${match.handle} is in progress with nothing open`,
          `${participants.map(participant => participant.name).join(' and ')} have no window, so that match cannot be played.`,
          `Cancel ${match.handle} on the match card to free the accounts, or open both profiles again.`
        )
      );
  }
  return list;
}

/** The one-line summary the panel heading uses. */
function summary(list) {
  const warnings = list.filter(entry => entry.level === 'warning').length;
  const infos = list.length - warnings;
  if (!list.length) return 'Nothing needs your attention.';
  return [warnings ? `${warnings} thing${warnings === 1 ? '' : 's'} to fix` : null, infos ? `${infos} to look at` : null]
    .filter(Boolean)
    .join(' · ');
}

module.exports = { items, summary };
