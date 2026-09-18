# ADR-0010 — Telemetry is local-only by default

- **Status:** Accepted
- **Date:** 2026-09-18
- **Related:** `src/workspace.cjs`, `src/network.cjs`, `src/ui/renderer.js`, roadmap M4/M7

## Context

This application holds live, authenticated sessions for real accounts. Anything it reports about
itself is therefore potentially sensitive: activity feeds name accounts, the region probe sees
balances and names, session files hold cookies, and an IP check reveals the user's address.

The category this product sits in is notorious for the opposite behaviour — the reference tool this
project was modelled on turned out to carry loggers and droppers, which is why the machine it ran on
had to be reset. That history makes the default posture part of the product, not a footnote.

Meanwhile M4 needs diagnostics to be good enough that a failure is fixable from a bundle alone. Those
two pull in opposite directions unless the default is chosen deliberately.

## Decision

**Nothing leaves the machine unless the user explicitly exports it.**

1. No analytics, crash reporting, or usage telemetry endpoint exists in the codebase.
2. The dashboard renderer makes no external requests at all (`connect-src 'none'` in its CSP).
3. The only outbound request the application makes on its own is the **Check IP** action, and only
   when the user clicks it. It goes through that account's own session to `api.ipify.org`,
   credential-free, with `cache: 'no-store'` and `redirect: 'error'`.
4. Addresses are held in memory and never written to the workspace file or the activity log.
5. Activity entries record actions, not credentials and not complete navigation URLs.
6. The M4 diagnostics bundle is user-initiated and must be provably clean: it excludes cookies,
   credentials, IP addresses and account names, and an automated scanner test asserts that.
7. Recognition returns a state, a score and matched phrases — never OCR text, never balances, never
   names.
8. No remote configuration, no remote code loading, no updater that pulls content.

## Consequences

### Positive

- A user can reason about exactly what this program sends, because the list has one entry.
- The account names in the dashboard never leave the device, including through a support bundle.
- The failure mode that destroyed the reference installation cannot recur here.

### Negative / costs

- No passive visibility into failures. Everything depends on the user exporting a bundle, so M4's
  bundle quality has to carry the whole load.
- No crash reports means bugs that only occur on one machine stay invisible until reported.
- A scanner test can only prove the absence of what it knows to look for, so the guarantee is
  "no known secret shape", not a proof.

## Alternatives considered

- **Opt-in telemetry with a hosted endpoint.** Rejected: it inverts the default, and a user who
  clicks past a dialog has changed the privacy posture of a program holding live sessions.
- **Local-only logging without a bundle.** Rejected: insufficient for M4's "diagnose in ten minutes"
  goal, and it puts log-reading burden on whoever debugs.
- **Anonymous usage counters.** Rejected: the value is low, and "anonymous" is hard to guarantee when
  the sample size is one.

## Enforcement

Test-backed where possible. `custom: 'none'` in the dashboard CSP and the absence of an outbound
request are structural; `npm run test:desktop` asserts the renderer has no `require` and drives the
IPC surface, and the M4 diagnostics bundle will carry an automated secret-scanner test (roadmap M4,
acceptance criterion 2). The remaining rules are enforced by review against this record.
