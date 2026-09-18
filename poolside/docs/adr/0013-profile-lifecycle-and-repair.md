# ADR-0013 — Profile lifecycle, generation tracking, and what repair may do

- **Status:** Accepted
- **Date:** 2026-09-18
- **Related:** ADR-0003 (persistent partitions), ADR-0004 (session storage authority), ADR-0006 (Electron
  pin), ADR-0012 (session identity surface), `BOUNDARIES.md` §1
- **Supersedes:** nothing. This is the first record covering profile lifecycle, integrity and deletion.

## Context

Every account has two layers of on-disk storage, and they have different authority:

| Layer              | Path                                  | Authority                              | If lost                               |
| ------------------ | ------------------------------------- | -------------------------------------- | ------------------------------------- |
| Chromium partition | `<userData>/Partitions/poolside-<id>` | owns all cookies, site storage, caches | a real re-login, possibly a challenge |
| Carry-over file    | `<userData>/accounts/<id>.plist`      | holds only session cookies, encrypted  | a sign-in for the session itself      |

M1's last piece adds the operations that had been missing entirely: establishing storage deliberately,
_detecting damage_ rather than discovering it as an exception, and deleting a profile on request. Each
one can destroy something if done carelessly. Before this record, nothing in the codebase created a
partition, checked a stored file, or removed one — so none of these decisions had been made anywhere.

## Decision

### 13.1 One writer

`src/profile-manager.cjs` owns the lifecycle. The destructive operation lives in
`src/profile-removal.cjs` and the repair in `src/profile-repair.cjs`, both called only from the manager.
No other module creates, repairs or deletes profile storage, and no caller reaches the removal or repair
module directly. The manager is what supplies "which sessions are open" and "record what happened", so
those two things cannot be skipped by a caller.

### 13.2 The generation counter counts directory establishments

It goes up when an account's storage **directory** is created, and when a directory that was previously
_seen_ is found missing and replaced. It does not move on an ordinary open, and it does not move for a
damaged carry-over file, because the directory was not re-established in that case.

This needs the persisted `established` flag, and the flag is the point: Chromium creates a partition
directory lazily on first use, so "the directory is absent" cannot distinguish _not used yet_ from
_deleted_. Without the flag the counter ticked on every open — a counter that measures nothing. A
profile that exists on disk with no record is recorded as `adopted`, not `created`, so a pre-existing
profile is never claimed as new.

### 13.3 Repair quarantines. It never rebuilds and never deletes

A damaged carry-over file is renamed to `<id>.plist.corrupt-<timestamp>` and kept. Nothing is deleted, so
the evidence survives; nothing is rebuilt, because the profile is authoritative and rebuilding a session
file from anything else would mean inventing cookies. The returned note says a sign-in may be needed
rather than claiming a recovery.

`repair` takes its own verdict rather than trusting its caller. A repair that could be talked into moving
a _healthy_ file would be a worse bug than the corruption it treats, and the cost is one extra small file
read.

### 13.4 Automatic repair is scoped to the carry-over file

The workspace document is **not** auto-repaired. A malformed document puts the app into read-only mode,
where it stays, rather than starting fresh. The asymmetry is deliberate: a damaged carry-over file costs
at most a sign-in, while a damaged workspace document holds the user-authored account records, and
"repair" there would mean discarding them. The document is validated strictly and reported honestly; it
is never silently replaced.

### 13.5 Deletion is explicit, confirmed natively, and refused while the session is open

- The only irreversible action in the application goes through a native `dialog.showMessageBox`, not a
  renderer-side confirm that a page script could forge.
- It is refused outright while that account's session is open: removing the directory underneath a live
  Chromium session leaves it writing into a deleted tree.
- The dashboard control is _disabled_, with the reason in its tooltip, while the session is open, so the
  refusal is structural rather than something the user discovers by pressing a button.
- A partition is never resolved by id during deletion. `session.fromPartition` **creates** the partition
  and its directory, so looking one up for the account being deleted resurrects the directory that was
  just removed. This was caught by the desktop self-test, which asserts the directory is gone.

### 13.6 A partial deletion is never reported as a success

Deletion removes the carry-over file, its quarantined copies, the partition directory and the persisted
record, and every failure is named. `ipc.cjs` turns any failure into an error message that says what was
removed and what was not, rather than returning success because most of it worked.

### 13.7 The sweep is conservative by rule

| Rule                                                                         | Why                                                                                                                                     |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Archived accounts are not orphans — the caller passes every account          | an archived account is still in the document, and deleting its storage would silently destroy a session the user may unarchive tomorrow |
| Only `poolside-<uuid>` directories and `<uuid>.plist` files are ever touched | Chromium keeps its own directories under `Partitions`, and a hand-placed file in `accounts` may be the user's own backup                |
| Every path is rebuilt here and re-checked against the data directory         | a corrupted workspace record cannot direct a delete elsewhere                                                                           |
| `apply: false` reports without touching anything                             | the same code produces a report and a change, so a report cannot describe a different set of files than the change acted on             |
| `unclaimed` means still on disk afterwards                                   | recording an entry as kept on its way past a successful delete reported it as both removed and left alone                               |

### 13.8 Diagnostics are split by lifetime

Durable bookkeeping — the generation counter and the corruption history — is persisted per account in the
workspace document. Measurements — bytes on disk, the file count, the configured ceiling, whether it is
exceeded — are re-derived on every scan and held in `state.profileReports`, never written. Writing the
whole workspace document every time a directory is measured would be churn for no gain, and a measurement
is not a fact worth surviving a restart.

The dashboard view merges the two, so the renderer sees one object and the distinction stays an
implementation detail.

### 13.9 Measurement is bounded, and says so

A Chromium partition is thousands of files, and an unbounded walk on a cold disk would stall startup. The
walk stops at a file cap (5000 by default) and reports `truncated`, so the number is always presented as
_at least_ this much. An entry that cannot be read increments `unreadable` rather than being skipped
silently, and an absent carry-over file reports `null` bytes — unknown, never zero. Startup runs the
integrity scan (a small file per account) before the window is shown, and the measurement after it, so
nothing waits on the slow half.

### 13.10 The ceiling is compared and reported, never enforced

The ceiling is the `quotaBytes` from the same identity configuration the session uses, so the number the
dashboard shows and the number the session claims come from one place. Exceeding it is reported. It is not
enforced, because Electron exposes no per-session quota to enforce it with (ADR-0012).

## Consequences

### Positive

- Deletion is provable, not merely plausible: the desktop self-test drives a real delete against real
  storage and asserts the directory, the files and the record are all gone.
- Damage is visible before it is a support question: a scan on startup records what was found and what was
  done about it, and the account carries a count.
- The one automatic destructive action is a rename, so no user data is ever destroyed by a startup path.
- Corrupt storage can no longer make an account unopenable-by-crash; it becomes a reported condition.

### Negative / costs

- Quarantined files accumulate by design. Bounded cleanup is M9 work, and deleting a profile is the
  intended way to clear them.
- The generation counter is not a monotonic clock: deleting the profile directory outside the app and
  letting it be recreated moves the counter, which is intended but is not a "profile was edited" signal.
- The sweep can only recognise our own two naming schemes. Anything else is reported and left, so a future
  change to the partition naming has to update `profile-paths.cjs` or the sweep will stop collecting.
- `repair` reads the file twice (once for its own verdict, once for the caller's). Accepted: the extra read
  is a few kilobytes, and the alternative is a repair that trusts a caller.

## Enforcement

| Rule                                                                             | Enforced by                                                 |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Traversal and outside-the-data-directory paths are refused                       | `test/profile-paths.test.cjs`                               |
| The verdict vocabulary, and that repair re-inspects before acting                | `test/profile-integrity.test.cjs`                           |
| Measurement, truncation and the ceiling comparison                               | `test/profile-diagnostics.test.cjs`                         |
| Lifecycle, generation semantics, archived-account safety, refusal while open     | `test/profile-manager.test.cjs`                             |
| The same through the real app, real data root and real encryption backend        | `src/self-test-profiles.cjs`, run by `npm run test:desktop` |
| No module over 200 lines; no cycles; all five profile modules stay Electron-free | `test/architecture.test.cjs`                                |

`npm run verify` must stay green, and the desktop suite must report 8 PASS.
