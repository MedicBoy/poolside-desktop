// What a session is configured with, and applying it.
//
// The configuration-facing half of a session, separated from `windows.cjs` so that "what is this session
// configured to do" reads as one file rather than a strand through the window lifecycle. It owns three things:
//
//   1. **The schema boundary** (ADR-0014). The account's configuration is validated against
//      `src/config-schema.cjs` *before* anything is executed. A structural error refuses the launch — that
//      state means the stored document is already corrupt, because `model.decode` would have caught it on the
//      way in. An unusable optional value is reported and the session opens anyway: a mistyped time zone must
//      never keep someone out of their own account.
//   2. **Applying the session-level half of the footprint** at the one moment Electron allows it:
//      `setUserAgent` does not affect existing WebContents, so it cannot wait until after the window exists.
//   3. Nothing else. Precedence between the workspace settings and the account's own configuration belongs to
//      `identity.cjs` and `proxy.cjs`; this module never merges them itself.
//
// No Electron import: the session and the user agent arrive as injected functions, which is what keeps this
// testable without a runtime. Enforced by test/architecture.test.cjs.

const configValidator = require('./config-validator.cjs');
const { resolveAndApplyFootprint } = require('./footprint.cjs');

/**
 * @param {{log: import('./types.cjs').LogFn, getSettings: () => any, sessionFor: (id: string) => any, userAgent: () => string}} deps
 */
function createSessionConfig(deps) {
  const { log, getSettings, sessionFor, userAgent } = deps;

  /** The workspace-level defaults that an account's own configuration overrides. */
  function settings() {
    const value = getSettings();
    return value && typeof value === 'object' ? value : {};
  }

  /**
   * Check the configuration this session is about to execute, and report what it decides. Throws on a
   * structural error; logs and continues on a dropped value.
   * @param {import('./types.cjs').Account} account
   */
  function check(account) {
    const checked = configValidator.validateSessionProfile({ settings: settings(), account });
    if (!checked.ok) {
      throw new Error(`Configuration refused for ${account.name}: ${configValidator.describeProblems(checked)}`);
    }
    if (checked.dropped.length) {
      log(`${account.name}: some configuration was ignored — ${configValidator.describeProblems(checked)}.`, 'warning');
    }
    return checked;
  }

  /**
   * Resolve and apply the half of the footprint Electron requires before a window exists.
   * @param {import('./types.cjs').Account} account
   */
  async function applyFootprint(account) {
    check(account);
    return resolveAndApplyFootprint(sessionFor(account.id), account, settings(), { log, baseUserAgent: userAgent() });
  }

  return { settings, check, applyFootprint };
}

module.exports = { createSessionConfig };
