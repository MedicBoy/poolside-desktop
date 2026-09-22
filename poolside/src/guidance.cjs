// What to do next, for a workspace that has not been set up yet.
//
// A brand-new Poolside shows an empty list and one button. That is enough to start, and not enough to know the
// shape of the thing: an account, a window, a signed-in session on the game's own site, then two of them. The
// steps are derived from the workspace rather than written into the page, so they cannot tell somebody to add
// an account they already have.
//
// Pure: it reads the snapshot it is handed and nothing else. It deliberately says nothing about signing in —
// whether an account is signed in on the game's website is not something this program can see, and the tracker's
// rule is that a claim without evidence is not a claim.

/** How many accounts the operator needs before a match can be coordinated at all. */
const NEEDED_ACCOUNTS = 2;

/**
 * @param {{accounts?: any[]}} input
 * @returns {{show: boolean, title: string, steps: {title: string, detail: string, action: string|null}[], note: string|null}}
 */
function forWorkspace({ accounts = [] } = {}) {
  const list = Array.isArray(accounts) ? accounts : [];
  if (list.length === 0)
    return {
      show: true,
      title: 'Set up your first session',
      steps: [
        { title: 'Add an account', detail: 'One account per game account you own.', action: 'add-account' },
        {
          title: 'Open it',
          detail: 'Poolside opens it in its own browser window with its own saved profile — nothing is shared with your everyday browser.',
          action: null
        },
        {
          title: 'Sign in on the game site',
          detail:
            "The sign-in happens on the game's own website, in that window. Poolside never sees the password and cannot tell you whether it worked.",
          action: null
        }
      ],
      note: 'Add a second account when you want to coordinate a match between two of your own.'
    };
  if (list.length < NEEDED_ACCOUNTS)
    return {
      show: true,
      title: 'One account so far',
      steps: [
        { title: 'Add a second account', detail: 'A match needs two, and each gets its own window and profile.', action: 'add-account' },
        { title: 'Open both', detail: "Open one, sign in on the game's site, then do the same for the other.", action: 'open-all' }
      ],
      note: null
    };
  const open = list.filter(account => !['closed', 'closing', undefined, null].includes(account.status)).length;
  if (open === 0)
    return {
      show: true,
      title: 'Both accounts are set up',
      steps: [
        { title: 'Open your accounts', detail: 'Each opens in its own window with its own saved sign-in.', action: 'open-all' },
        {
          title: 'Sign in on each game window',
          detail: "Sign-in happens on the game's own site; Poolside cannot see whether it worked.",
          action: null
        }
      ],
      note: 'When both are loaded you can pair them on the Matches view — or start a run with a plan.'
    };
  return { show: false, title: '', steps: [], note: null };
}

module.exports = { forWorkspace, NEEDED_ACCOUNTS };
