# Changelog

## Unreleased

- Balances are now read from the game's own screen: the two figures the play surface draws with no words next to them are identified by their position in the balance band and split apart by the gap between them, so an unlabelled number is never guessed from the largest value on screen.
- A reading's confidence is now the recogniser's own, taken from the least certain word of the figure. The previous fixed value made every labelled reading permanently "uncertain"; the two on-screen balances now read as current or uncertain on their real evidence.
- An abbreviated figure such as `3.23k` is shown as approximate rather than as an exact balance.
- Each screen state is set aside once as unreviewed evidence the first time it is recognised. Evidence is excluded from the benchmark, so an unreviewed state cannot raise the accuracy figure it is measured by.
- The workspace now paints before the individual controls are wired, so a single missing control can no longer blank the whole window. That failure mode made an intact workspace look deleted.

## 0.2.0 - 2026-09-19

- Added saved route presets in Settings, with per-account assignment and route-source reporting.
- Added live-status controls: a per-account interval (15-300 seconds) that pauses a background window until it is focused again.
- Added reading status: a locally read coin/cash/rank/trophy value is now labelled current, uncertain, or stale from one rule, so an unsure or old reading is never shown as the current figure.
- Completed local Account management, activity history, capture review, and session reliability controls.
- Improved Settings with schema-driven browser identity defaults, clear help text, and route validation.
- Packaged a Windows x64 release with an SBOM and SHA-256 release inspection.

## 0.1.0

- Initial local workspace: isolated persistent browser sessions, account slots, route checking, local screen inspection, and profile storage.
