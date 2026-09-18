# ADR-0006 — Exact Electron version pinning

- **Status:** Accepted
- **Date:** 2026-09-18
- **Related:** `package.json`, `src/windows.cjs`, roadmap M8

## Context

The application is pinned to Electron `44.4.1` exactly, with no range. That was inherited, but it
turned out to be load-bearing, for a reason discovered while testing:

**When the process's last `BrowserWindow` is destroyed, the next `BrowserWindow` created in the same
process fails to load with `ERR_FAILED (-2)`.** Reproduced for persistent and in-memory partitions,
with and without a `protocol.handle` fixture, and even with a `data:` URL. Keeping one window alive
for the process lifetime makes every later window load normally, and the same run logs
`GPU state invalid after WaitForGetOffsetInRange`, which points at compositor teardown.

That is a rendering-runtime behaviour, not application logic. It already shaped real code: the
persistence test keeps a hidden window alive purely because of it, and the note in
`test/session-restart.cjs` exists so nobody removes it as a "tidiness" change.

Windows-visibility behaviour is exactly the class of thing Electron patch releases change.

## Decision

Electron is pinned to an exact version (`44.4.1`, no `^` or `~`). Upgrades are deliberate and take
this route:

1. Branch. Bump the pin and `npm ci`.
2. Run the full gate: `npm run verify`, `npm run test:desktop`, `npm run test:persistence`.
3. Re-run the packaged self-test from a fresh build.
4. Specifically re-check the window lifecycle: close every game window, then open another, and
   confirm it loads. This is the behaviour that has already broken once.
5. Record the outcome — including "no change" — and only then merge.

The reason for the pin is written down here so it is not removed by someone "modernising"
`package.json`.

## Consequences

### Positive

- The compositor behaviour above is known and stable; the test that depends on it stays valid.
- Upgrades become a decision with a checklist rather than a silent dependency bump.
- Packaging, native module compilation (`sharp`), and asar layout stay reproducible.

### Negative / costs

- Security and Chromium updates require action rather than arriving automatically. This is the
  significant cost, and it is why the procedure above exists.
- Third-party Electron tooling may assume a range and warn.
- Sticking on one version means the eventual jump is larger and may need real work.

## Alternatives considered

- **Caret range (`^44.4.1`).** Rejected: it would silently change rendering behaviour under a test
  suite that cannot see the difference until a window fails to load.
- **Track latest stable continuously.** Rejected: the failure above is invisible to unit tests and
  would surface as a user-visible "the second account will not open".
- **Pin Chromium separately.** Not possible: the Chromium version is determined by Electron.

## Enforcement

Review only, deliberately. `test/session-restart.cjs` documents the dependency at the point where it
matters, and `npm run test:desktop` fails if window creation breaks. A `engines` field for Node
(`>=22`) is declared in `package.json`; Electron has no equivalent, hence this record.
