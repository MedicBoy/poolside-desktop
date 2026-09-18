# ADR-0003 — Persistent Chromium partitions per account

- **Status:** Accepted
- **Date:** 2026-09-18
- **Related:** `src/windows.cjs`, `src/saved-session.cjs`, `test/session-restart.cjs`, roadmap M1/M2

## Context

Accounts must not share cookies or site storage, and each account's login has to survive a window
close, an app restart, and a machine restart. The original build used in-memory partitions
(`session.fromPartition('poolside-<id>')`), which enforces isolation but discards everything on
exit — the user had to sign in on every launch, which is the friction that started this whole line
of work.

Chromium gives two options. A `persist:` prefix makes Electron keep a real profile on disk, managed
by Chromium: cookies, `localStorage`, IndexedDB, cache, and its own cookie database. The alternative
is a hand-managed profile directory, where the application owns every file and every schema.

Hand-managing means owning cookie database compatibility, encryption of the cookie store, corruption
recovery, and every future Chromium format change. Chromium already does all of that, and it is the
component that knows how to.

## Decision

Each account gets a persistent partition named `persist:poolside-<account id>`. Chromium owns the
profile directory.

The application owns only:

- the partition naming (one account, one partition, derived from a validated UUID),
- the session/navigation policy applied to that partition,
- and the encrypted carry-over file for session cookies (ADR-0004).

## Consequences

### Positive

- Login state survives process and machine restarts, verified by `npm run test:persistence` across
  two real Electron processes.
- Isolation is enforced by Chromium, not by our own directory discipline.
- Cookie encryption, schema migration and corruption handling are Chromium's problem.
- `localStorage` and the rest of site storage come along for free, which the in-memory version lost.

### Negative / costs

- Disk usage grows per account, and profiles are opaque: we cannot read or repair their internals,
  only delete them.
- Chromium's profile format is versioned by the Chromium version, so an Electron upgrade is a
  profile-format upgrade (see ADR-0006).
- Session cookies are still dropped by Chromium on close, which is why ADR-0004 exists rather than
  "the profile handles everything".
- Write timing is Chromium's, so a save cannot be made synchronous on demand.

## Alternatives considered

- **In-memory partitions.** Rejected: isolation without persistence, and the user re-authenticates
  on every launch.
- **A shared persistent partition.** Rejected: it would log the second account in as the first —
  exactly the failure the user described from ordinary browser windows.
- **A hand-managed profile directory per account.** Rejected: we would be reimplementing Chromium's
  cookie store, including its encryption and migrations, with no upside.

## Enforcement

Test-backed. `npm run test:desktop` asserts two partitions keep separate cookie jars and that a
cookie survives a window close and reopen; `npm run test:persistence` asserts both accounts' cookies
and `localStorage` survive a full process restart independently. `test/architecture.test.cjs` keeps
the session modules free of Electron imports so this stays unit-testable.
