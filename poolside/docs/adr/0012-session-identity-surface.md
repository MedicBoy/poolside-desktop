# ADR-0012 — Session identity surface, and the limits of it

- **Status:** Accepted
- **Date:** 2026-09-18
- **Related:** ADR-0011 §11.4 and §11.6 (what identity configuration is allowed to be), ADR-0003
  (persistent partitions), `INCOMPLETE_WORK.md`, roadmap M1

## Context

M1 promised per-session identity configuration — user agent, accepted languages, locale, timezone,
viewport, colour scheme — "through Electron's supported surface", plus a storage quota, all asserted by
a fixture page reading `navigator` and `Intl` back.

Building it against a live browser produced three measurements that the design had to be changed around.
None of them were knowable from the documentation:

1. **`session.setUserAgent(ua, acceptLanguages)` does not deliver its second argument.** In Electron
   44.4.1 the user agent takes effect, but the accepted-languages list does not: `navigator.language`
   keeps the OS value and the outgoing request carries **no `Accept-Language` header at all**. Verified
   by echoing request headers from a local fixture.
2. **`session.setUserAgent` also does not affect an existing `WebContents`** (documented), so it has to
   run before the window is constructed.
3. **A CDP command sent to a window that has never navigated is applied but never answered.** The
   command takes effect and its reply never arrives, so an `await` on it hangs forever — with no window
   to close. Observed directly: `Emulation.setLocaleOverride` set the locale correctly and still timed
   out.
4. **Electron exposes no per-session storage quota.** There is no `setQuota` or `storageQuota` anywhere
   in the Session API, so "enforce a quota" is not implementable as stated. Separately, a page can read
   Chromium's own allowance through `navigator.storage.estimate()`.

## Decision

**1. Identity is applied through two mechanisms, at two moments, and the split is the honest one.**

- _Session level, before the window exists:_ `session.setUserAgent(userAgent)`. It is the documented API
  and it does set the user agent for the session.
- _Target level, over CDP, on a live target:_ user agent **and** accepted languages
  (`Emulation.setUserAgentOverride`), locale (`Emulation.setLocaleOverride`), timezone
  (`Emulation.setTimezoneOverride`), viewport (`Emulation.setDeviceMetricsOverride`), colour scheme
  (`Emulation.setEmulatedMedia`).

The user agent is deliberately set through **both**. The CDP override is what the page and the server
actually see, because the session-level call cannot deliver accepted languages (measurement 1). Applying
only the session-level API would mean shipping a language setting that does nothing.

**2. Target overrides are opt-in per account, and the trade-off is stated rather than hidden.**

They require an attached debugger, which means DevTools cannot be opened on that window and the target is
inspectable. A session with no identity configured attaches nothing and behaves exactly as before. This
is a per-account configuration decision, not a global switch, so it is visible in the config that caused
it.

**3. Before attaching, the target is given a renderer.**

`applyTargetFootprint` navigates to `about:blank` when the window has no URL yet. This is not a
workaround for a slow attach: it is required for the commands to answer at all (measurement 3), and it
also places the overrides _before_ the real page's first script runs, which is what the feature was
supposed to guarantee. The overrides survive the navigation that follows — measured.

**4. The storage ceiling is reported, never described as enforced.**

`quotaBytes` is a configured ceiling that the runtime measures the session's HTTP disk cache against and
warns about when exceeded. It is not described as a cap anywhere in the code, the UI or the docs, because
Chromium does not apply one (measurement 4). A page can independently report its own quota and usage via
`navigator.storage.estimate()`; that is a measurement too, not a control.

**5. Every CDP command is raced against a deadline.**

A command that never answers must not be able to hold a session open forever. On expiry the partial
result is kept and reported, and the session continues with whatever did apply.

## Consequences

### Positive

- The identity configuration is verified against a real page rather than asserted: the self-test reads
  `navigator.userAgent`, `navigator.language`, `navigator.languages`,
  `Intl.DateTimeFormat().resolvedOptions().locale`, `.timeZone`, `window.innerWidth/innerHeight` and the
  `prefers-color-scheme` media query back out of two differently-configured sessions, and prints them.
- Two sessions with different identities are proved isolated from each other, which is the claim the
  feature makes.
- The three measurements are written down with their evidence, so the next person does not re-derive
  them — and does not "fix" the CDP user agent override back into the session-level call.
- Nothing about the default path changed: no identity configured means no debugger, no pre-navigation and
  no proxy call.

### Negative / costs

- An account with identity target overrides has an attached debugger, which is a real functional
  limitation (no DevTools on that window) and a heavier act than setting a header. It is opt-in for that
  reason.
- The pre-navigation to `about:blank` costs one extra navigation per session open when overrides are
  configured.
- The storage ceiling can be exceeded without consequence beyond a warning. That is a weaker control than
  the roadmap originally implied, and the honest response was to weaken the claim rather than fake the
  enforcement.
- Locale, timezone, viewport and colour scheme are emulation, so they describe what the page sees. They
  are not a claim about the OS-level environment of that Chromium process (a native library reading the
  system timezone directly would not see the override).

## Alternatives considered

- **Session-level API only.** Rejected: measurement 1 means accepted languages would silently do nothing,
  which is exactly the class of false belief this project is trying to avoid elsewhere.
- **Set the user agent and languages by relaunching Electron with `--lang`/`--user-agent`.** Rejected:
  those are process-wide, so they cannot give each account its own identity, which is the entire point.
- **Apply target overrides after the first real navigation.** Rejected: the overrides would land after the
  page's first script run, so a page that reads `Intl` at startup would see the un-overridden values.
  The `about:blank` pre-navigation keeps the guarantee without the hang.
- **Describe `quotaBytes` as a quota and clear the cache when exceeded.** Rejected: clearing a user's
  session cache to make a number look enforced is destructive and still not a quota.
- **Ship without a deadline on CDP commands and document the hang.** Rejected: a stalled command would
  hold a session open with no window to close, which is the failure mode this milestone exists to remove.

## Enforcement

- `test/identity.test.cjs` asserts the exact CDP command list an identity implies, so removing the user
  agent override (and reintroducing the inert setting) fails the suite.
- `test/*` cover the pure decision logic: field validation, route parsing and comparison, restore
  arithmetic.
- The packaged self-test asserts the read-back from a real page for two differently-configured sessions,
  and asserts that the route resolver's answer matches the configured route. It prints the raw values, so
  a failure elsewhere is diagnosable from the output.
- The absence of a storage-quota API is stated in `footprint.cjs`, in this record, and in
  `architecture.md`. A future change that claims enforcement must supersede this ADR.
