# POOLSIDE — INCOMPLETE WORK

|                |                                                                                        |
| -------------- | -------------------------------------------------------------------------------------- |
| **Purpose**    | Record the remaining implementation and verification work for the next developer       |
| **Pairs with** | `poolside/MASTER_ROADMAP.md` and `poolside/docs/work-items.json` (A–Q IDs)             |
| **Baseline**   | 0.3.11 development preview; use the generated capability report for exact build claims |
| **Status**     | Remaining-work register; older M-series notes below are historical context             |

This file lists only unfinished or externally verified work. Completed capabilities are documented in
`poolside/docs/CAPABILITIES.md`, the roadmap, and the architecture records. Work-item statuses are tracked in
`poolside/docs/work-items.json`; do not read the historical M-series shorthand as completion evidence.

## Remaining verification

**Packaging defect corrected in 0.3.11 source:** Windows npm stripped a caret from the old ignore
expression, omitting `docs/release*` while admitting local `.log` files. The package command now
uses shell-safe ignore patterns, and `release:inspect` refuses missing capability/release documents,
version disagreement, unexpected root files, or local-data paths. A fresh standard package and its
self-test pass locally; hosted CI and clean-VM distribution checks remain O1/O7 work.

| #   | Work still required                                                                            | Completion evidence                                                                                           |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | Expand the recognition corpus with real success and failure captures                           | Labelled corpus contains representative live-game states and failures                                         |
| 2   | Validate game-surface ranking on the live site                                                 | `Inspect game` selects the correct surface across representative pages                                        |
| 3   | Run CI on the chosen remote                                                                    | All repository checks pass in the hosted runner                                                               |
| 4   | Choose and configure the production signing certificate                                        | A signed package installs without an unknown-publisher warning                                                |
| 5   | Test install, update, rollback, and removal on a clean Windows VM                              | Release checklist passes on a machine without the development toolchain                                       |
| 6   | Run the 72-hour soak and 16-session stretch tests                                              | Results and resource measurements are recorded                                                                |
| 7   | Reproduce and characterize GPU/compositor failures on target hardware                          | Failure mode, driver/GPU details, and recovery result are recorded                                            |
| 8   | Expand the current 108 held-out labelled frames to the 300-sample coverage gate and rerun it   | Capture Lab and `npm run validate:corpus` both pass                                                           |
| 9   | Measure cold start, capture, classification, IPC throughput, and memory on a reference machine | Evidence replay now reports local OCR-stage timing; reference-machine results are added to the release record |
| 10  | Prove missing/corrupt workspace recovery in packaged Windows and clean-VM tests                | Local restore tests pass; packaged restore preserves the original and reopens with the chosen accounts         |

## Unfinished product capabilities

The following capabilities are not implemented in this repository. They require design, development,
tests, and live-site validation before they can be treated as product features.

### Game input integration

No production module sends pointer or keyboard input to the game surface. A per-session table-navigation state
machine, timeout/cancel/retry policy, bounded transition journal, and deliberately no-click dry-run adapter now
define the integration boundary. Completing live input still requires coordinate translation, focus and lifecycle
handling, capture-backed target evidence, and fixture-backed input tests before live validation.

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
3. Validate the implemented game-facing table-navigation state model against the completed capture corpus.
4. Implement coordinate-aware input and live match-state observation behind the existing dry-run interface.
5. Add coordination, match completion, and accounting as separate testable modules.
6. Add any required identity, routing, or import capabilities with explicit validation and diagnostics.

## Current completion summary

- Session/profile platform, configuration, diagnostic timeline, telemetry, and settings UI are implemented.
- Recognition foundations are implemented, but real-world accuracy remains unmeasured.
- Production release verification is incomplete until hosted CI, signing, clean-VM, soak, and scale tests pass.
- The table-navigation workflow is implemented as a no-click dry run; live input, coordination, completion, and transfer remain unimplemented.
