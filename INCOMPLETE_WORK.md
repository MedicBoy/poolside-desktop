# POOLSIDE — INCOMPLETE WORK

|                |                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------- |
| **Purpose**    | Record the remaining implementation and verification work for the next developer              |
| **Pairs with** | `ROADMAP.md` (v1.0) — milestone IDs match                                                     |
| **Baseline**   | commit `5054e82` (M5), preceded by M4 `3907873`, M3 `67c9931`, M2 `252fe17`, and M1 `7f37aa1` |
| **Status**     | Handoff reference                                                                             |

This file lists only unfinished or externally verified work. Completed capabilities are documented in
`PROJECT_HANDOFF.md`, the roadmap, and the architecture records.

## Remaining verification

| #   | Work still required                                                                            | Completion evidence                                                     |
| --- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | Expand the recognition corpus with real success and failure captures                           | Labelled corpus contains representative live-game states and failures   |
| 2   | Validate game-surface ranking on the live site                                                 | `Inspect game` selects the correct surface across representative pages  |
| 3   | Run CI on the chosen remote                                                                    | All repository checks pass in the hosted runner                         |
| 4   | Choose and configure the production signing certificate                                        | A signed package installs without an unknown-publisher warning          |
| 5   | Test install, update, rollback, and removal on a clean Windows VM                              | Release checklist passes on a machine without the development toolchain |
| 6   | Run the 72-hour soak and 16-session stretch tests                                              | Results and resource measurements are recorded                          |
| 7   | Reproduce and characterize GPU/compositor failures on target hardware                          | Failure mode, driver/GPU details, and recovery result are recorded      |
| 8   | Validate recognition accuracy against at least 300 labelled frames                             | ADR-0002 accuracy gate is measured and reported                         |
| 9   | Measure cold start, capture, classification, IPC throughput, and memory on a reference machine | Performance results are added to the release record                     |

## Unfinished product capabilities

The following capabilities are not implemented in this repository. They require design, development,
tests, and live-site validation before they can be treated as product features.

### Game input integration

No production module sends pointer or keyboard input to the game surface. Completing this requires an
input adapter, coordinate translation, focus and lifecycle handling, cancellation, error reporting,
and fixture-backed tests before live validation.

### Multi-account matchmaking coordination

There is no scheduler or shared matchmaking state for coordinating several accounts into the same
match. Completing this requires a defined state machine, synchronization strategy, timeouts,
observability, recovery behavior, and validation against the current game flow.

### Match completion workflow

Forfeit/leave handling, confirmation flows, win/loss tracking, and repeated-match limits are not
implemented. The existing session status only describes the local browser lifecycle; it does not
identify opponents or establish match outcomes.

### Per-session device identity controls

The application supports user agent, locale, timezone, viewport, color scheme, and route settings.
It does not implement HWID, install-date, canvas, WebGL, audio, or other device-fingerprint controls.
Any future implementation needs a supported configuration model, measurable read-back, persistence,
and compatibility tests.

### Matchmaking-aware routing

Per-session proxy routing exists as infrastructure. Route selection based on matchmaking-pool size,
opponent likelihood, or regional coordination is not implemented. It would require pool measurement,
route-selection logic, health checks, fallback behavior, and live validation.

### Credential and session import

The application persists cookies created inside its own Chromium sessions. It does not parse or import
tokens, cookies, or authentication material from external `.plist` files or other sources. An importer
would require a documented input format, validation, secure storage, migration behavior, and tests.

### Transfer accounting

Balance read-back, pot verification, per-account value tracking, and transfer reconciliation are not
implemented. Diagnostics may display visible session information, but no accounting model consumes it.

### Challenge handling and reference-tool compatibility

Cloudflare/bot-challenge handling, loader compatibility, reference-tool internals, and end-to-end
behavior matching are not implemented or validated.

## Suggested implementation order

1. Build the real labelled corpus and complete live surface-selection validation.
2. Run CI, clean-VM release checks, signing, and the long-duration reliability tests.
3. Define the game-facing state model and integration contracts.
4. Implement input integration and live match-state observation behind fixture-backed interfaces.
5. Add coordination, match completion, and accounting as separate testable modules.
6. Add any required identity, routing, or import capabilities with explicit validation and diagnostics.

## Current completion summary

- Session/profile platform, configuration, diagnostic timeline, telemetry, and settings UI are implemented.
- Recognition foundations are implemented, but real-world accuracy remains unmeasured.
- Production release verification is incomplete until hosted CI, signing, clean-VM, soak, and scale tests pass.
- The game-facing automation and transfer workflow described above remains unimplemented.
