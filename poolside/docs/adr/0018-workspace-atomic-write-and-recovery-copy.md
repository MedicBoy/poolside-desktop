# ADR-0018 — Workspace atomic write and bounded recovery copy

- **Status:** Accepted
- **Date:** 2026-09-21
- **Related:** `src/workspace-file.cjs`, `src/workspace.cjs`, `test/workspace-file.test.cjs`, Blueprint B2/B3/B8

## Context

The workspace holds account identities and preferences. The earlier fixed `.tmp` write followed by a rename did not flush the staged file, retain a known-good copy, or recognize a stranded staging file when the primary was missing. A crash or external file contention could therefore leave recovery data on disk while the app presented an empty workspace.

## Decision

Every save validates the complete version-1 document, writes a unique sibling staging file, flushes its contents, and renames it over the primary. When the old primary is valid, one flushed `.previous` copy is retained before replacement. A damaged old primary is never copied into `.previous` or overwritten by a normal save.

An old recovery copy is purged when an account, account label/note/identity/proxy, workspace identity/proxy, or route preset is removed or changed. This prevents a normal deletion or credential-clear action from retaining the removed value in that sibling. The primary remains intact if a pre-commit stage fails.

On startup, a missing primary plus a `.previous`, legacy `.tmp`, or new staged file puts the workspace into read-only recovery mode. A malformed primary also stays read-only. Neither path automatically promotes a recovery file into authoritative account data.

## Consequences

### Positive

- An interrupted save leaves the prior primary intact; deterministic faults at each stage are tested.
- Recovery material is bounded to one sibling plus any files stranded by a process crash.
- Account and route removals do not linger in the managed recovery copy after a successful save.

### Negative / costs

- File flushing and the extra copy add synchronous disk work to workspace changes.
- Windows and OneDrive can still refuse a rename. The operation then fails without publishing the proposed in-memory document.
- There is no in-app restore UI yet. Read-only recovery requires a deliberate manual restore or a future reviewed B3 workflow. A file flush and rename are not proof of power-loss durability on every filesystem; clean-VM interruption tests remain required.
- Older, unmanaged backups and external filesystem snapshots are outside this copy's retention policy.

## Alternatives considered

- **Auto-load `.previous`:** rejected because a stale backup must not silently become the authoritative account list and trigger profile cleanup.
- **Keep the old copy after deletion:** rejected because it could retain deleted account metadata or proxy credentials.
- **No copy:** rejected because a primary lost to disk damage would have no local recovery candidate.

## Enforcement

`test/workspace-file.test.cjs` injects failures before commit and checks the primary and staging files. `test/workspace-load.test.cjs` covers missing-primary recovery mode. The packaged Electron self-test checks the copy after real account saves. Hosted CI and clean-VM interruption evidence are still pending.
