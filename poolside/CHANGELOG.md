# Changelog

## Unreleased

## 0.3.11 - 2026-09-21

- Added a single capability registry consumed by the About view, diagnostics export, and generated Markdown/JSON reports. Unavailable game input, pairing, match accounting, signing, and updates remain explicitly off; recognition is labelled development evidence rather than live accuracy proof.
- Tracked all 142 blueprint deliverables with owner roles, dependencies, acceptance text, status, and evidence contracts. The source gate now rejects roadmap/register or generated-report drift.
- Recorded the conservative preview support boundary, decision templates, and a versioned release-evidence folder/validator with hash, containment, privacy-review, signature-evidence, matrix, and sign-off gates. It does not certify this unsigned preview.
- Recorded the current game-service-rule risk as an explicit authorization/review gate for future live input and coin-transfer features; no game input was enabled.
- Reconciled README, architecture, incomplete-work register, ADR-0011, and release checklist. The existing personal milestone tracker is maintained separately outside the app.
- Corrected Windows package ignore rules so release documentation is included and local logs are excluded; package inspection now fails for missing product-truth files, version disagreement, or unexpected/private archive paths.

## 0.3.10 - 2026-09-21

- Added a validated, flushed, unique-staging workspace writer with one bounded previous-known-good copy. Missing primary files with recovery material now open read-only rather than appearing as a new empty workspace; no backup is silently made authoritative.
- Added deterministic failure tests for interrupted writes and damaged primaries. Removal or clearing of account and route values purges the managed recovery copy so deleted metadata or proxy credentials do not linger there.
- Expanded the Windows CI workflow to run two-process persistence checks, explicit corpus-validation contract tests, package inspection, packaged desktop self-test, and upload of hash/SBOM evidence. Hosted CI, the real held-out corpus gate, signing, and clean-VM recovery remain unverified.
- Added an ADR and per-build release-evidence template. The desktop self-test now uses a valid sending-account fixture and verifies the workspace recovery copy through real Electron account saves.

## 0.3.9 - 2026-09-21

- Added fixed numeric timing stages for first OCR, visual matching, contrast preparation/OCR, bottom-band preparation/OCR, reading extraction, and total recognition. The read-only Evidence replay reports stage use counts and percentiles without exposing OCR text or capture data.
- Prevented an OCR result arriving after the 30-second inspection deadline from saving a capture or replacing the failure state. Timed-out requests also leave the reader queue instead of accumulating behind a stalled worker. Image capture/preparation time no longer includes time waiting for a reader; regression tests cover both failure paths.
- Replayed all 113 reviewed Evidence images without modifying them or opening Benchmark images: 113/113 screen labels and 65/65 table names matched in-sample. Full-reader p95 was 1,698 ms; table-selection first OCR p50 was 915 ms, visual matching p50 46 ms, and 17/65 table images still required contrast OCR. This remains development evidence, not a passed 800 ms release gate.

## 0.3.8 - 2026-09-21

- Used the new capture aggregate without consuming held-out Benchmark images for tuning. The held-out set now has 108 captures, but still lacks the required size, per-label/per-table coverage, and latency proof.
- Avoided the second full-frame OCR pass after a distinctive first-pass Shop classification. A read-only comparison of all 13 reviewed Shop Evidence images found identical labels and visible reading values with and without that pass; the saved images and capture-time records remain untouched.
- Added explicitly experimental, read-only Evidence replay options for input scaling, central-card crops, and first-versus-full reading comparison. Global scaling lost real promotion screens and the central crop missed table screens, so neither is used in production.
- The complete read-only Evidence replay matched 113/113 saved screen labels on this build; the roughly 1.7-second local OCR p95 remains above the release target and is not held-out validation.

## 0.3.7 - 2026-09-21

- Added a read-only, aggregate-only Evidence replay command to measure current first-pass versus full-pipeline screen recognition and timing without trusting stale capture-time results or using held-out Benchmark images.
- Added narrow Lucky Promotion dialog and three observed Shop layout rules supported by reviewed real captures. The promotion rule distinguishes its popup from the Lucky Shot play screen; multiple rules for one screen produce one state candidate rather than duplicate alternatives.
- Skipped the second full-frame OCR pass for a confidently recognized promotion dialog or Lucky Shot entry screen, preserving the full OCR path for screens with balances or less distinctive wording.
- Replayed all 112 reviewed Evidence images against the updated pipeline without changing them: all screen labels matched, but the roughly 2-second OCR p95 remains over the release target. This is development data, not held-out validation.

## 0.3.6 - 2026-09-21

- Clarified that the production table-coverage minimum counts only held-out Benchmark images; the user's labelled Evidence images remain saved and are reported separately with their original capture-time detector results.
- Added a conservative local visual assist for decorative 1-on-1 venue logos. It learns only from reviewed or detector-confirmed Evidence images, verifies their hashes, requires multiple examples per venue, refuses ambiguous matches, and never uses Benchmark images. It adds a confident centered venue to live table observations without enabling game input.
- Avoided the second full-frame OCR pass when the first pass identifies table selection and the local visual assist finds a strong venue match. Other screens retain the existing OCR path.
- Added an aggregate-only `npm run analyze:tables` development report for leave-one-out table Evidence checks without printing screenshots, account details, OCR text, or file paths. This is not a held-out accuracy result.

## 0.3.5 - 2026-09-21

- Removed Miami from the supported web 1-on-1 table catalog. Old saved Miami preferences migrate safely to Dubai, and the active UI, recognition, navigation, and corpus coverage lists no longer offer Miami.
- Replaced clipped per-icon help bubbles with a single viewport-aware tooltip that stays inside every window edge, flips above or below its icon, and works with both pointer and keyboard focus.
- Made repeated completed page-load signals idempotent at the session-event boundary. Sign-in redirects can now finish after a session is already ready without creating a false lifecycle warning in Activity.

## 0.3.4 - 2026-09-21

- Fixed a login-persistence regression proved by the local activity history: startup could delete a valid browser profile and encrypted session-cookie file after its account id became temporarily unclaimed. Startup now reports unclaimed login storage and preserves interrupted-write session files but never deletes either.
- Account-window closure now immediately queues that account's encrypted session-cookie save, while the process-wide quit flush remains the final durability barrier.
- Extended the real two-process Electron restart test to exercise the production profile-store prepare and per-account close-flush path for session cookies, persistent cookies, and local storage.

## 0.3.3 - 2026-09-21

- Removed Dallas and Venice from the supported web 1-on-1 table catalog and added Dubai; legacy saved preferences migrate safely to Dubai.
- Capture Lab now opens at the top, counts actual evidence samples, reports screen-label coverage separately, and shows every supported table's saved and detected counts.
- Table-selection cards now show the saved expected table and the OCR-detected table as separate fields. Benchmark rows show sample and successful-detection counts, including the reason for unavailable precision values.
- Open game windows now start local live-screen observation automatically, and the workspace status reflects loading, lobby, table-selection, promotion, shop, and unrecognized observations instead of remaining on a static browser-ready message.
- The receiving role remains selectable when another receiver exists. A native confirmation atomically demotes the old receiver and assigns the new one, preserving the one-receiver rule.

## 0.3.2 - 2026-09-21

- Fixed Capture Lab's table-name control so it is hidden, disabled, and cleared for every non-table screen. Table Selection samples now require an explicit table choice and do not silently inherit the previous/default table.

## 0.3.1 - 2026-09-21

- Added a per-session table-navigation dry run with target selection, an explicit state machine, manual-step guidance, timeouts, cancellation, retry, and a bounded local transition journal. The adapter deliberately sends no game input.

## 0.3.0 - 2026-09-21

- Removed the accidental Blank, Error, and Unknown capture labels. Failed recognition is now an internal outcome rather than a screen a person can select or review as real.
- Added table-specific capture labels so table-selection evidence records which table is actually visible.
- Made a zero-item review queue visually neutral and clickable only when captures really need review.
- Made the workspace display the running package version instead of a hard-coded label, preventing stale builds from looking current.
- Raised the source-module architecture ceiling to 300 lines while retaining the cycle and isolation checks.
- Hardened profile startup cleanup, authenticated proxy handling, CI verification, and corpus validation.
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
