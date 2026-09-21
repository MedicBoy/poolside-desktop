# ADR-0011 — Game automation remains unimplemented

- **Status:** Current implementation record
- **Date:** 2026-09-18
- **Related:** ADR-0007, `INCOMPLETE_WORK.md`, roadmap §0.1

## Context

The application currently provides isolated Chromium sessions, local screen-state recognition,
profile management, diagnostics, and configuration. The intended end-to-end workflow also requires
game input, match coordination, outcome tracking, and transfer accounting. Those components do not
exist in the current module graph.

Several completed infrastructure features are adjacent to that missing workflow. Per-session routes
do not select matchmaking pools. Session identity settings do not provide device-fingerprint controls.
Screen capture and OCR do not operate game controls. Cookie persistence does not import credentials
from external files. These distinctions describe the present implementation and prevent completed
infrastructure from being mistaken for an end-to-end automation system.

## Current state

The following capabilities are unfinished:

1. Production pointer and keyboard input to the game surface.
2. Shared matchmaking state and multi-account scheduling.
3. Forfeit/leave flows, outcome detection, and repeated-match limits.
4. Device-fingerprint configuration beyond the existing browser settings.
5. Route selection informed by matchmaking conditions.
6. External token, cookie, or session import.
7. Balance, pot, and transfer reconciliation.
8. Challenge handling and compatibility with the reference tool's full behavior.

## Required implementation work

Each capability needs an explicit module contract, configuration schema, lifecycle and cancellation
behavior, structured diagnostics, fixture coverage, integration tests, and live validation. The
game-facing state model should be defined before input or coordination is connected so that recovery
and partial failure behavior are observable rather than implicit.

## Consequences

- The repository is a usable multi-session, recognition, and diagnostics platform, but it is not a
  complete transfer automation product.
- The existing read-only session and telemetry interfaces are suitable foundations for later work.
- Estimates for the remaining workflow must include both implementation and live-site validation.
- Changes to game-facing behavior should update this record and `INCOMPLETE_WORK.md` as components land.

## Verification

The repository tests enforce module reachability, dependency direction, and size. Feature completion
must additionally be demonstrated with focused unit tests, Electron integration tests, and recorded
live validation because source-shape checks cannot establish game behavior.
