# Architectural Decision Records

An ADR records a decision that is expensive to reverse, the context it was made in, and what it
costs us. They are written for whoever reads this codebase in six months — possibly us.

## Index

| ADR                                                | Title                                                  | Status                 |
| -------------------------------------------------- | ------------------------------------------------------ | ---------------------- |
| [0001](0001-commonjs-for-the-main-process.md)      | CommonJS for the main process                          | Accepted               |
| [0002](0002-recognition-stack.md)                  | Recognition stack: Tesseract + Sharp, revisited at M3  | Accepted (provisional) |
| [0003](0003-persistent-chromium-partitions.md)     | Persistent Chromium partitions per account             | Accepted               |
| [0004](0004-session-storage-authority.md)          | One authority for session storage (defect D3)          | Accepted               |
| [0005](0005-ipc-contract-versioning.md)            | IPC contract shape and versioning                      | Accepted               |
| [0006](0006-electron-version-pinning.md)           | Exact Electron version pinning                         | Accepted               |
| [0007](0007-game-facing-test-strategy.md)          | Game-facing test strategy                              | Accepted               |
| [0008](0008-config-schema-tooling.md)              | Config schema tooling                                  | Accepted               |
| [0009](0009-error-taxonomy.md)                     | Error taxonomy and user-facing messages                | Accepted               |
| [0010](0010-local-only-telemetry.md)               | Telemetry is local-only by default                     | Accepted               |
| [0011](0011-operational-scope-boundaries.md)       | Operational scope boundaries                           | Accepted               |
| [0012](0012-session-identity-surface.md)           | Session identity surface, and the limits of it         | Accepted               |
| [0013](0013-profile-lifecycle-and-repair.md)       | Profile lifecycle, generation, and what repair may do  | Accepted               |
| [0014](0014-configuration-validation-semantics.md) | Configuration validation semantics and the drift guard | Accepted               |
| [0015](0015-vision-recognition-processing.md)      | Vision capture: coordinates, transforms, boundaries    | Accepted               |

## Template

```markdown
# ADR-000N — Title

- **Status:** Accepted | Proposed | Superseded by ADR-000M
- **Date:** YYYY-MM-DD
- **Related:** files, defects, roadmap milestone

## Context

What forces are at play, including the constraint that made this a decision rather than a default.

## Decision

What we are doing, in the present tense.

## Consequences

### Positive

### Negative / costs

What we are accepting in exchange. An ADR with no costs listed has not been thought through.

## Alternatives considered

Each with the reason it was rejected.

## Enforcement

How the decision is kept true — a test, a lint rule, a CI check, or "review only" with the reason.
```

## Conventions

- One decision per record. If a record needs "and", it is two records.
- ADRs are immutable once Accepted. A changed decision gets a new ADR that supersedes the old one;
  the old one's status is updated to point at it.
- Anything that changes a decision must update or add an ADR in the same change.
- "Enforcement: review only" is allowed, but it must say why no test can hold the line.
