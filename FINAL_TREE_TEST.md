# FINAL TREE TEST — Poolside

**Executed:** 18 September 2026, on this machine, against the working tree at `bf28e95`
**Scope:** repository sanity and tree audit, the complete verification pipeline with its raw output, and the M0–M5 milestone sign-off
**Method:** every figure and every quoted line below was produced by running the command shown, in this session. Raw streams are embedded verbatim from captured logs, not retyped or summarised.

---

## 1. COMPREHENSIVE REPOSITORY SANITY & TREE AUDIT

### 1.1 Version control state

| Item | Value |
| --- | --- |
| Repository root | `C:\Users\nicho\OneDrive\Desktop\Coding` |
| Application root | `C:\Users\nicho\OneDrive\Desktop\Coding\poolside` |
| Branch | `master` (trunk-based) |
| **HEAD commit** | **`bf28e9564c962e40500005dc930c4b00892de5c1`** — *docs(handoff): note which commit the audit was taken at* |
| Commit author | `nicho <nicho@localhost>` (repo-local identity; no global git identity exists on this machine) |
| Commit date | Fri Sep 18 17:59:59 2026 -0230 |
| Commits since release tag | 24 (tag `v0.1.0-session-foundation` = `3834705`) |
| Tracked files (whole repo) | **235** |

### 1.2 Working tree status — stated exactly

`git status --porcelain` was run natively. Its **complete, unabridged** output:

```
?? "Note from ChatGPT.txt"
?? "PROJECT_HANDOFF - Copy.md"
```

Asserting this precisely rather than in summary form:

| Assertion | Result |
| --- | --- |
| Modified tracked files | **0** |
| Staged changes | **0** |
| Deleted or renamed tracked files | **0** |
| Untracked **code** files (anything under `poolside/src`, `poolside/test` or `poolside/docs`) | **0** |
| Untracked files at the repo root | **2**, both non-code and both the user's own: `Note from ChatGPT.txt` (a note left in the root directory), and `PROJECT_HANDOFF - Copy.md` (a duplicate copy of the hand-off document produced in the previous session) |

**So: the codebase is fully committed and the tracked tree is clean. Two loose non-code files sit at the repo root, deliberately left untracked rather than swept into a commit** — a `git add -A` that swept one of them into a milestone commit previously had to be amended, and that lesson is recorded in the project skill. Neither file is referenced by any source, test, or documentation in the project.

One further precision, because "100% clean deployment" can mean two different things: `poolside/release/` — the packaged Electron build — is **gitignored by design** (an earlier `.gitignore` pattern let ~1 GB of Electron binaries get tracked, which was corrected). It therefore does not appear in `git status` and is not part of the tracked tree. It exists on disk, was rebuilt after the last `src/` change, and is verified in §2.5.

### 1.3 File-tree inventory

Counts below come from `git ls-files` (tracked) and `ls` (on-disk), both run natively:

| Location | Count | Composition |
| --- | --- | --- |
| `poolside/src/` | **64 tracked** | 61 `*.cjs` modules + 3 UI assets (`ui/index.html`, `ui/renderer.js`, `ui/style.css`) |
| `poolside/test/` | **35 tracked** | 25 `*.test.cjs` suites + 2 harness scripts (`run-session-restart.cjs`, `session-restart.cjs`) + 8 fixtures (7 PNG screens + `vision-corpus.json`) |
| `poolside/docs/` | **19 tracked** | 17 architecture decision records (`0001`–`0017`) + the ADR index + `architecture.md` |
| `poolside/` (root files) | remainder | `package.json`, `package-lock.json`, `README.md`, `CONTRIBUTING.md`, `eslint.config.mjs`, `tsconfig.json`, `.prettierrc.json`, `.gitignore` |
| Repo root | remainder | `ROADMAP.md`, `BOUNDARIES.md`, `PROJECT_HANDOFF.md`, this document, review material |

| Directory (tracked) | Files |
| --- | ---: |
| `recording-review` | 102 |
| `poolside/src` | 61 |
| `poolside/test` | 27 |
| `poolside/docs/adr` | 18 |
| `poolside` | 10 |
| `poolside/test/fixtures` | 8 |
| `(repository root)` | 5 |
| `poolside/src/ui` | 3 |
| `poolside/docs` | 1 |
| **Total** | **235** |


### 1.4 Structural assertions

| Assertion | How it is held |
| --- | --- |
| Every `src/` module is reachable | `test/architecture.test.cjs` fails on a module unreferenced from source or tests — no dead files |
| The local `require` graph is acyclic | `test/architecture.test.cjs` walks the whole graph and fails on any cycle |
| 37 of 61 modules are declared pure | `PURE_MODULES` in the same suite; each is asserted to contain no `electron` import, so they stay unit-testable without a runtime |
| No module exceeds 200 lines | `test/architecture.test.cjs`; see §2.4 |
| Fixtures are real files, not fabricated at test time | `test/fixtures/` holds 7 recorded PNG screens plus the structured corpus, all tracked |

---

## 2. CORE CODE STABILITY & VERIFICATION METRICS

### 2.1 The pipeline, executed

`npm run verify` expands to `npm run lint && npm run typecheck && npm test`. It was run natively and its **complete raw output stream** is embedded below — all 1,569 lines, exactly as the console produced them, including the TAP records for every individual test.

```text

> poolside@0.1.0 verify
> npm run lint && npm run typecheck && npm test


> poolside@0.1.0 lint
> eslint .


> poolside@0.1.0 typecheck
> tsc --noEmit


> poolside@0.1.0 test
> node --test test/*.test.cjs

TAP version 13
# Subtest: no source module exceeds the modularity ceiling
ok 1 - no source module exceeds the modularity ceiling
  ---
  duration_ms: 31.3202
  type: 'test'
  ...
# Subtest: the composition root stays a wiring layer
ok 2 - the composition root stays a wiring layer
  ---
  duration_ms: 0.9776
  type: 'test'
  ...
# Subtest: the local require graph is acyclic
ok 3 - the local require graph is acyclic
  ---
  duration_ms: 21.2404
  type: 'test'
  ...
# Subtest: pure modules do not depend on Electron
ok 4 - pure modules do not depend on Electron
  ---
  duration_ms: 28.1731
  type: 'test'
  ...
# Subtest: every module is reachable from a require or a documented reference
ok 5 - every module is reachable from a require or a documented reference
  ---
  duration_ms: 34.4402
  type: 'test'
  ...
# Subtest: the gates still recognise the real screens (no behaviour change from the regex chain)
ok 6 - the gates still recognise the real screens (no behaviour change from the regex chain)
  ---
  duration_ms: 3.9829
  type: 'test'
  ...
# Subtest: table selection wins over lobby wording, because the lobby renders behind it
ok 7 - table selection wins over lobby wording, because the lobby renders behind it
  ---
  duration_ms: 0.9601
  type: 'test'
  ...
# Subtest: incomplete or unrelated text stays unknown instead of guessing
ok 8 - incomplete or unrelated text stays unknown instead of guessing
  ---
  duration_ms: 1.5048
  type: 'test'
  ...
# Subtest: the bare loading gate is permissive by design and is flagged for M3
ok 9 - the bare loading gate is permissive by design and is flagged for M3
  ---
  duration_ms: 0.5688
  type: 'test'
  ...
# Subtest: unknown results carry no confidence
ok 10 - unknown results carry no confidence
  ---
  duration_ms: 1.8468
  type: 'test'
  ...
# Subtest: results report a bounded score and the phrases that matched
ok 11 - results report a bounded score and the phrases that matched
  ---
  duration_ms: 0.6233
  type: 'test'
  ...
# Subtest: a fuller screen scores at least as high as a sparser one of the same state
ok 12 - a fuller screen scores at least as high as a sparser one of the same state
  ---
  duration_ms: 0.4717
  type: 'test'
  ...
# Subtest: arrays of OCR passes are scored together, matching the pipeline contract
ok 13 - arrays of OCR passes are scored together, matching the pipeline contract
  ---
  duration_ms: 0.4985
  type: 'test'
  ...
# Subtest: non-English or reworded screens degrade to unknown rather than a wrong label
ok 14 - non-English or reworded screens degrade to unknown rather than a wrong label
  ---
  duration_ms: 0.9357
  type: 'test'
  ...
# Subtest: every rule declares a gate and no rule can match on hints alone
ok 15 - every rule declares a gate and no rule can match on hints alone
  ---
  duration_ms: 1.1982
  type: 'test'
  ...
# Subtest: the rewrite is behaviour-preserving against the embedded legacy classifier
ok 16 - the rewrite is behaviour-preserving against the embedded legacy classifier
  ---
  duration_ms: 1.8257
  type: 'test'
  ...
# Subtest: the schema declares exactly the fields the grammar and the storage layer know
ok 17 - the schema declares exactly the fields the grammar and the storage layer know
  ---
  duration_ms: 4.1345
  type: 'test'
  ...
# Subtest: every declared field has a working rule and a label
ok 18 - every declared field has a working rule and a label
  ---
  duration_ms: 180.6406
  type: 'test'
  ...
# Subtest: a document carrying every declared field survives decode unchanged
ok 19 - a document carrying every declared field survives decode unchanged
  ---
  duration_ms: 4.0734
  type: 'test'
  ...
# Subtest: the validator emits a shape the storage layer keeps
ok 20 - the validator emits a shape the storage layer keeps
  ---
  duration_ms: 9.0544
  type: 'test'
  ...
# Subtest: the validator and the hand-written settings validator agree on every supplied value
ok 21 - the validator and the hand-written settings validator agree on every supplied value
  ---
  duration_ms: 2.5721
  type: 'test'
  ...
# Subtest: an absent settings value is not a rejected one
ok 22 - an absent settings value is not a rejected one
  ---
  duration_ms: 1.0759
  type: 'test'
  ...
# Subtest: routes are validated by the parser that will apply them, not by a second pattern
ok 23 - routes are validated by the parser that will apply them, not by a second pattern
  ---
  duration_ms: 1.4787
  type: 'test'
  ...
# Subtest: bypass entries go through the same normaliser the runtime uses
ok 24 - bypass entries go through the same normaliser the runtime uses
  ---
  duration_ms: 0.6072
  type: 'test'
  ...
# Subtest: a dropped field is reported by path and the rest of the configuration survives
ok 25 - a dropped field is reported by path and the rest of the configuration survives
  ---
  duration_ms: 1.3851
  type: 'test'
  ...
# Subtest: a structural error is fatal, and every problem is reported at once
ok 26 - a structural error is fatal, and every problem is reported at once
  ---
  duration_ms: 1.1963
  type: 'test'
  ...
# Subtest: an unknown key is reported rather than discarded in silence
ok 27 - an unknown key is reported rather than discarded in silence
  ---
  duration_ms: 0.7891
  type: 'test'
  ...
# Subtest: required fields are required in validation and supplied by applyDefaults, which are different operations
ok 28 - required fields are required in validation and supplied by applyDefaults, which are different operations
  ---
  duration_ms: 1.6502
  type: 'test'
  ...
# Subtest: there are no cross-field rules, so the resolver stays the only authority on precedence
ok 29 - there are no cross-field rules, so the resolver stays the only authority on precedence
  ---
  duration_ms: 0.6096
  type: 'test'
  ...
# Subtest: the boundary check validates sections separately and never merges them
ok 30 - the boundary check validates sections separately and never merges them
  ---
  duration_ms: 1.9166
  type: 'test'
  ...
# Subtest: nothing here throws, whatever it is handed
ok 31 - nothing here throws, whatever it is handed
  ---
  duration_ms: 1.4316
  type: 'test'
  ...
# Subtest: describeProblems is null when there is nothing to say
ok 32 - describeProblems is null when there is nothing to say
  ---
  duration_ms: 0.3294
  type: 'test'
  ...
# Subtest: the summary counts what the header needs
ok 33 - the summary counts what the header needs
  ---
  duration_ms: 5.6912
  type: 'test'
  ...
# Subtest: the session layer carries state, reason and the crash flags
ok 34 - the session layer carries state, reason and the crash flags
  ---
  duration_ms: 0.923
  type: 'test'
  ...
# Subtest: the storage layer keeps unknown distinct from empty
ok 35 - the storage layer keeps unknown distinct from empty
  ---
  duration_ms: 2.4367
  type: 'test'
  ...
# Subtest: the payload is built from a fixed clock when asked
ok 36 - the payload is built from a fixed clock when asked
  ---
  duration_ms: 2.4695
  type: 'test'
  ...
# Subtest: findSecrets finds planted secrets in an unredacted payload
ok 37 - findSecrets finds planted secrets in an unredacted payload
  ---
  duration_ms: 3.1614
  type: 'test'
  ...
# Subtest: the export layer of the same payload is clean
ok 38 - the export layer of the same payload is clean
  ---
  duration_ms: 8.9366
  type: 'test'
  ...
# Subtest: the export layer keeps the accounts correlated without identifying them
ok 39 - the export layer keeps the accounts correlated without identifying them
  ---
  duration_ms: 0.9271
  type: 'test'
  ...
# Subtest: the scanner does not cry wolf on the shapes this payload legitimately contains
ok 40 - the scanner does not cry wolf on the shapes this payload legitimately contains
  ---
  duration_ms: 0.8358
  type: 'test'
  ...
# Subtest: every declared layer says what it may contain
ok 41 - every declared layer says what it may contain
  ---
  duration_ms: 5.0779
  type: 'test'
  ...
# Subtest: nothing here throws, whatever it is handed
ok 42 - nothing here throws, whatever it is handed
  ---
  duration_ms: 5.7858
  type: 'test'
  ...
# Subtest: unrecognized or incomplete labels cannot establish a usable game screen
ok 43 - unrecognized or incomplete labels cannot establish a usable game screen
  ---
  duration_ms: 4.216
  type: 'test'
  ...
# Detected 12 diacritics
# Subtest: local OCR recognizes reference and held-out recorded screens; unreadable loading stays unknown
ok 44 - local OCR recognizes reference and held-out recorded screens; unreadable loading stays unknown
  ---
  duration_ms: 8935.9236
  type: 'test'
  ...
# Subtest: nothing remembered is a first run, not an error
ok 45 - nothing remembered is a first run, not an error
  ---
  duration_ms: 5.5041
  type: 'test'
  ...
# Subtest: a sound record is restored exactly, with no adjustment claimed
ok 46 - a sound record is restored exactly, with no adjustment claimed
  ---
  duration_ms: 0.8832
  type: 'test'
  ...
# Subtest: corrupt records degrade to nothing remembered instead of throwing or opening a broken window
ok 47 - corrupt records degrade to nothing remembered instead of throwing or opening a broken window
  ---
  duration_ms: 0.4748
  type: 'test'
  ...
# Subtest: a remembered size below the minimum is grown, not applied
ok 48 - a remembered size below the minimum is grown, not applied
  ---
  duration_ms: 0.6577
  type: 'test'
  ...
# Subtest: a window larger than the current display is fitted to it
ok 49 - a window larger than the current display is fitted to it
  ---
  duration_ms: 0.5084
  type: 'test'
  ...
# Subtest: a window on a display that is no longer attached is centred on the primary
ok 50 - a window on a display that is no longer attached is centred on the primary
  ---
  duration_ms: 0.8646
  type: 'test'
  ...
# Subtest: a window whose title bar is off the top is moved back inside the work area
ok 51 - a window whose title bar is off the top is moved back inside the work area
  ---
  duration_ms: 0.7241
  type: 'test'
  ...
# Subtest: a window the user deliberately left slightly off the edge is left alone
ok 52 - a window the user deliberately left slightly off the edge is left alone
  ---
  duration_ms: 0.5987
  type: 'test'
  ...
# Subtest: the display it overlaps most wins, so a second monitor is respected
ok 53 - the display it overlaps most wins, so a second monitor is respected
  ---
  duration_ms: 1.1195
  type: 'test'
  ...
# Subtest: with no display information the record is returned untouched
ok 54 - with no display information the record is returned untouched
  ---
  duration_ms: 1.5268
  type: 'test'
  ...
# Subtest: a maximized window remembers that it was maximized
ok 55 - a maximized window remembers that it was maximized
  ---
  duration_ms: 1.1562
  type: 'test'
  ...
# Subtest: rememberBounds rounds, stamps, and keeps the display it was on
ok 56 - rememberBounds rounds, stamps, and keeps the display it was on
  ---
  duration_ms: 1.6078
  type: 'test'
  ...
# Subtest: describeRestore explains what happened in one line
ok 57 - describeRestore explains what happened in one line
  ---
  duration_ms: 0.6873
  type: 'test'
  ...
# Subtest: nothing configured resolves to a complete, explicitly empty identity
ok 58 - nothing configured resolves to a complete, explicitly empty identity
  ---
  duration_ms: 4.9965
  type: 'test'
  ...
# Subtest: an account overrides only the fields it sets and inherits the rest from the workspace default
ok 59 - an account overrides only the fields it sets and inherits the rest from the workspace default
  ---
  duration_ms: 118.3481
  type: 'test'
  ...
# Subtest: a full identity survives resolution unchanged
ok 60 - a full identity survives resolution unchanged
  ---
  duration_ms: 0.9888
  type: 'test'
  ...
# Subtest: an invalid time zone is dropped with a warning instead of being applied
ok 61 - an invalid time zone is dropped with a warning instead of being applied
  ---
  duration_ms: 1.4081
  type: 'test'
  ...
# Subtest: an invalid locale is dropped, and a region-less one is accepted
ok 62 - an invalid locale is dropped, and a region-less one is accepted
  ---
  duration_ms: 1.2938
  type: 'test'
  ...
# Subtest: acceptLanguages must be a comma-separated list of real language tags
ok 63 - acceptLanguages must be a comma-separated list of real language tags
  ---
  duration_ms: 0.6568
  type: 'test'
  ...
# Subtest: a viewport outside the sane range is refused at both ends
ok 64 - a viewport outside the sane range is refused at both ends
  ---
  duration_ms: 0.6136
  type: 'test'
  ...
# Subtest: a user agent carrying a line break is refused, because it could inject a header
ok 65 - a user agent carrying a line break is refused, because it could inject a header
  ---
  duration_ms: 0.854
  type: 'test'
  ...
# Subtest: colour scheme accepts only the two values the media query understands
ok 66 - colour scheme accepts only the two values the media query understands
  ---
  duration_ms: 1.4937
  type: 'test'
  ...
# Subtest: quotaBytes is reported data, so it must be a positive whole number or absent
ok 67 - quotaBytes is reported data, so it must be a positive whole number or absent
  ---
  duration_ms: 1.3336
  type: 'test'
  ...
# Subtest: unknown keys in a hand-edited workspace file do not ride along
ok 68 - unknown keys in a hand-edited workspace file do not ride along
  ---
  duration_ms: 1.1047
  type: 'test'
  ...
# Subtest: target overrides are exactly the CDP commands the identity implies
ok 69 - target overrides are exactly the CDP commands the identity implies
  ---
  duration_ms: 1.1964
  type: 'test'
  ...
# Subtest: a user agent without languages overrides only the user agent
ok 70 - a user agent without languages overrides only the user agent
  ---
  duration_ms: 0.4621
  type: 'test'
  ...
# Subtest: a quota ceiling alone needs no debugger attach
ok 71 - a quota ceiling alone needs no debugger attach
  ---
  duration_ms: 0.355
  type: 'test'
  ...
# Subtest: the summary names what is set and stays honest about what is not
ok 72 - the summary names what is set and stays honest about what is not
  ---
  duration_ms: 0.724
  type: 'test'
  ...
# Subtest: a single window keeps the standard minimum (regression: D7)
ok 73 - a single window keeps the standard minimum (regression: D7)
  ---
  duration_ms: 2.2238
  type: 'test'
  ...
# Subtest: arranging eight windows restores the standard minimum when reduced to one (regression: D7)
ok 74 - arranging eight windows restores the standard minimum when reduced to one (regression: D7)
  ---
  duration_ms: 0.5134
  type: 'test'
  ...
# Subtest: the minimum never exceeds the tile for any count
ok 75 - the minimum never exceeds the tile for any count
  ---
  duration_ms: 0.7154
  type: 'test'
  ...
# Subtest: cramped grids are reported rather than silently clamped
ok 76 - cramped grids are reported rather than silently clamped
  ---
  duration_ms: 0.3018
  type: 'test'
  ...
# Subtest: tiles tile the work area without gaps or overlap
ok 77 - tiles tile the work area without gaps or overlap
  ---
  duration_ms: 2.0396
  type: 'test'
  ...
# Subtest: geometry respects a non-zero work-area origin (multi-monitor)
ok 78 - geometry respects a non-zero work-area origin (multi-monitor)
  ---
  duration_ms: 0.5266
  type: 'test'
  ...
# Subtest: invalid input is rejected rather than producing a broken layout
ok 79 - invalid input is rejected rather than producing a broken layout
  ---
  duration_ms: 4.0851
  type: 'test'
  ...
# Subtest: account slots have distinct IDs and prevent ambiguous receiver or duplicate labels
ok 80 - account slots have distinct IDs and prevent ambiguous receiver or duplicate labels
  ---
  duration_ms: 5.2032
  type: 'test'
  ...
# Subtest: workspace decoder rejects invalid paths, duplicate IDs, and malformed settings
ok 81 - workspace decoder rejects invalid paths, duplicate IDs, and malformed settings
  ---
  duration_ms: 5.1939
  type: 'test'
  ...
# Subtest: identity, route and remembered geometry survive a decode round trip
ok 82 - identity, route and remembered geometry survive a decode round trip
  ---
  duration_ms: 3.2571
  type: 'test'
  ...
# Subtest: unusable geometry and unknown keys are dropped without costing the workspace
ok 83 - unusable geometry and unknown keys are dropped without costing the workspace
  ---
  duration_ms: 1.0389
  type: 'test'
  ...
# Subtest: IP check uses the supplied session and omits credentials
ok 84 - IP check uses the supplied session and omits credentials
  ---
  duration_ms: 136.5846
  type: 'test'
  ...
# Subtest: IP check rejects service errors, malformed addresses and oversized responses
ok 85 - IP check rejects service errors, malformed addresses and oversized responses
  ---
  duration_ms: 13.3811
  type: 'test'
  ...
# Subtest: a document is well formed and carries every field
ok 86 - a document is well formed and carries every field
  ---
  duration_ms: 4.0792
  type: 'test'
  ...
# Subtest: an account name cannot break out of the document
ok 87 - an account name cannot break out of the document
  ---
  duration_ms: 0.7731
  type: 'test'
  ...
# Subtest: the payload round-trips, including across line breaks
ok 88 - the payload round-trips, including across line breaks
  ---
  duration_ms: 0.7756
  type: 'test'
  ...
# Subtest: a document with no payload reads as null rather than throwing
ok 89 - a document with no payload reads as null rather than throwing
  ---
  duration_ms: 0.5716
  type: 'test'
  ...
# Subtest: a missing field reads as null, and a key substring is not matched
ok 90 - a missing field reads as null, and a key substring is not matched
  ---
  duration_ms: 0.5532
  type: 'test'
  ...
# Subtest: escaping covers every entity that could alter the document
ok 91 - escaping covers every entity that could alter the document
  ---
  duration_ms: 0.348
  type: 'test'
  ...
# Subtest: a profile directory that does not exist yet is missing, not an error
ok 92 - a profile directory that does not exist yet is missing, not an error
  ---
  duration_ms: 7.8478
  type: 'test'
  ...
# Subtest: sizes and counts include nested files, and symlink entries are never followed
ok 93 - sizes and counts include nested files, and symlink entries are never followed
  ---
  duration_ms: 24.1022
  type: 'test'
  ...
# Subtest: the walk is bounded and admits it when it stops early
ok 94 - the walk is bounded and admits it when it stops early
  ---
  duration_ms: 20.5789
  type: 'test'
  ...
# Subtest: the report adds the carry-over file to the partition total, and keeps them separate
ok 95 - the report adds the carry-over file to the partition total, and keeps them separate
  ---
  duration_ms: 28.7906
  type: 'test'
  ...
# Subtest: the ceiling is a comparison and only ever reports
ok 96 - the ceiling is a comparison and only ever reports
  ---
  duration_ms: 17.1314
  type: 'test'
  ...
# Subtest: byte sizes are rendered the way a person reads them
ok 97 - byte sizes are rendered the way a person reads them
  ---
  duration_ms: 0.664
  type: 'test'
  ...
# Subtest: the one-line description never presents the ceiling as enforcement
ok 98 - the one-line description never presents the ceiling as enforcement
  ---
  duration_ms: 18.7515
  type: 'test'
  ...
# Subtest: a capped walk says "at least", because the number is a lower bound
ok 99 - a capped walk says "at least", because the number is a lower bound
  ---
  duration_ms: 20.0936
  type: 'test'
  ...
# Subtest: the temporary-file sweep removes abandoned writes and nothing else
ok 100 - the temporary-file sweep removes abandoned writes and nothing else
  ---
  duration_ms: 24.3156
  type: 'test'
  ...
# Subtest: the sweep tolerates a data directory that has no accounts folder yet
ok 101 - the sweep tolerates a data directory that has no accounts folder yet
  ---
  duration_ms: 3.7852
  type: 'test'
  ...
# Subtest: a missing carry-over file is normal, not a fault
ok 102 - a missing carry-over file is normal, not a fault
  ---
  duration_ms: 7.3766
  type: 'test'
  ...
# Subtest: a healthy v2 file is reported ok with its cookie count and version
ok 103 - a healthy v2 file is reported ok with its cookie count and version
  ---
  duration_ms: 22.4535
  type: 'test'
  ...
# Subtest: a v1 payload is legacy, not corruption: it is narrowed on read and rewritten on the next save
ok 104 - a v1 payload is legacy, not corruption: it is narrowed on read and rewritten on the next save
  ---
  duration_ms: 9.9079
  type: 'test'
  ...
# Subtest: a file with no encrypted payload is corrupt
ok 105 - a file with no encrypted payload is corrupt
  ---
  duration_ms: 10.3247
  type: 'test'
  ...
# Subtest: a file whose header names another account is corrupt, before anything is decrypted
ok 106 - a file whose header names another account is corrupt, before anything is decrypted
  ---
  duration_ms: 152.3802
  type: 'test'
  ...
# Subtest: a payload belonging to another account is corrupt even when the header agrees
ok 107 - a payload belonging to another account is corrupt even when the header agrees
  ---
  duration_ms: 15.9193
  type: 'test'
  ...
# Subtest: a payload version this build does not know is corrupt, not silently ignored
ok 108 - a payload version this build does not know is corrupt, not silently ignored
  ---
  duration_ms: 18.7247
  type: 'test'
  ...
# Subtest: an undecryptable payload is corrupt, and an unavailable keychain is unverifiable
ok 109 - an undecryptable payload is corrupt, and an unavailable keychain is unverifiable
  ---
  duration_ms: 12.4183
  type: 'test'
  ...
# Subtest: a payload that is not JSON is corrupt rather than fatal
ok 110 - a payload that is not JSON is corrupt rather than fatal
  ---
  duration_ms: 39.9747
  type: 'test'
  ...
# Subtest: a file whose header disagrees with its payload is usable but suspect
ok 111 - a file whose header disagrees with its payload is usable but suspect
  ---
  duration_ms: 11.6103
  type: 'test'
  ...
# Subtest: an unfamiliar format string is noted without making the file unusable
ok 112 - an unfamiliar format string is noted without making the file unusable
  ---
  duration_ms: 48.1363
  type: 'test'
  ...
# Subtest: repair quarantines the damaged file and deletes nothing
ok 113 - repair quarantines the damaged file and deletes nothing
  ---
  duration_ms: 14.4405
  type: 'test'
  ...
# Subtest: repair on a healthy or absent file does nothing
ok 114 - repair on a healthy or absent file does nothing
  ---
  duration_ms: 34.8745
  type: 'test'
  ...
# Subtest: summarise counts verdicts for one log line
ok 115 - summarise counts verdicts for one log line
  ---
  duration_ms: 0.9191
  type: 'test'
  ...
# Subtest: initialising establishes storage once and counts the generation
ok 116 - initialising establishes storage once and counts the generation
  ---
  duration_ms: 40.8958
  type: 'test'
  ...
# Subtest: a profile that has disappeared is re-created and the generation moves on
ok 117 - a profile that has disappeared is re-created and the generation moves on
  ---
  duration_ms: 35.7859
  type: 'test'
  ...
# Subtest: a pre-existing profile with no record is adopted rather than claimed as new
ok 118 - a pre-existing profile with no record is adopted rather than claimed as new
  ---
  duration_ms: 15.9636
  type: 'test'
  ...
# Subtest: the scan quarantines a damaged file and records the history on the account
ok 119 - the scan quarantines a damaged file and records the history on the account
  ---
  duration_ms: 22.762
  type: 'test'
  ...
# Subtest: corruption history accumulates rather than resetting
ok 120 - corruption history accumulates rather than resetting
  ---
  duration_ms: 41.7841
  type: 'test'
  ...
# Subtest: the scan leaves a healthy account alone and reports a clean summary
ok 121 - the scan leaves a healthy account alone and reports a clean summary
  ---
  duration_ms: 15.9582
  type: 'test'
  ...
# Subtest: the sweep removes unclaimed storage and leaves everything else alone
ok 122 - the sweep removes unclaimed storage and leaves everything else alone
  ---
  duration_ms: 20.3737
  type: 'test'
  ...
# Subtest: an archived account keeps its profile, because it is still in the document
ok 123 - an archived account keeps its profile, because it is still in the document
  ---
  duration_ms: 7.157
  type: 'test'
  ...
# Subtest: measuring reports disk usage against the configured ceiling
ok 124 - measuring reports disk usage against the configured ceiling
  ---
  duration_ms: 29.4121
  type: 'test'
  ...
# Subtest: deleting a profile removes its storage and its record
ok 125 - deleting a profile removes its storage and its record
  ---
  duration_ms: 27.7838
  type: 'test'
  ...
# Subtest: deleting refuses while the session is open, before touching anything
ok 126 - deleting refuses while the session is open, before touching anything
  ---
  duration_ms: 10.4155
  type: 'test'
  ...
# Subtest: an account id must be a uuid, because it becomes a path segment
ok 127 - an account id must be a uuid, because it becomes a path segment
  ---
  duration_ms: 4.0346
  type: 'test'
  ...
# Subtest: the two storage locations are derived, never passed in
ok 128 - the two storage locations are derived, never passed in
  ---
  duration_ms: 0.9784
  type: 'test'
  ...
# Subtest: isInside is strict: the directory itself is not inside itself
ok 129 - isInside is strict: the directory itself is not inside itself
  ---
  duration_ms: 1.347
  type: 'test'
  ...
# Subtest: assertRemovable refuses anything outside the data directory
ok 130 - assertRemovable refuses anything outside the data directory
  ---
  duration_ms: 5.8932
  type: 'test'
  ...
# Subtest: a quarantined file keeps the damaged one and stays inside the data directory
ok 131 - a quarantined file keeps the damaged one and stays inside the data directory
  ---
  duration_ms: 2.1659
  type: 'test'
  ...
# Subtest: partition entries are split into ours, Chromium's, and unusable names
ok 132 - partition entries are split into ours, Chromium's, and unusable names
  ---
  duration_ms: 2.5341
  type: 'test'
  ...
# Subtest: account entries are split into carry-over files, quarantined copies, and other names
ok 133 - account entries are split into carry-over files, quarantined copies, and other names
  ---
  duration_ms: 1.3794
  type: 'test'
  ...
# Subtest: a bare host:port applies to every scheme
ok 134 - a bare host:port applies to every scheme
  ---
  duration_ms: 5.8084
  type: 'test'
  ...
# Subtest: a scheme prefix is preserved, including SOCKS
ok 135 - a scheme prefix is preserved, including SOCKS
  ---
  duration_ms: 1.3936
  type: 'test'
  ...
# Subtest: DIRECT is a route, not an error
ok 136 - DIRECT is a route, not an error
  ---
  duration_ms: 0.4061
  type: 'test'
  ...
# Subtest: a route without a port, a bad port, or an unknown scheme is refused with a reason
ok 137 - a route without a port, a bad port, or an unknown scheme is refused with a reason
  ---
  duration_ms: 2.7875
  type: 'test'
  ...
# Subtest: bypass rules accept hostnames, wildcards, CIDR and <local>, and refuse anything else
ok 138 - bypass rules accept hostnames, wildcards, CIDR and <local>, and refuse anything else
  ---
  duration_ms: 1.6364
  type: 'test'
  ...
# Subtest: an unconfigured session is left alone, which is not the same as forcing direct
ok 139 - an unconfigured session is left alone, which is not the same as forcing direct
  ---
  duration_ms: 0.7718
  type: 'test'
  ...
# Subtest: a route that is switched off is reported as disabled rather than applied
ok 140 - a route that is switched off is reported as disabled rather than applied
  ---
  duration_ms: 0.4749
  type: 'test'
  ...
# Subtest: an unusable route is reported rather than half-applied
ok 141 - an unusable route is reported rather than half-applied
  ---
  duration_ms: 0.4804
  type: 'test'
  ...
# Subtest: a valid route carries the rules Electron needs, and the target to check against
ok 142 - a valid route carries the rules Electron needs, and the target to check against
  ---
  duration_ms: 1.4102
  type: 'test'
  ...
# Subtest: an account route overrides the workspace route
ok 143 - an account route overrides the workspace route
  ---
  duration_ms: 1.23
  type: 'test'
  ...
# Subtest: describeResolvedRoute reads Chromium's own answer
ok 144 - describeResolvedRoute reads Chromium's own answer
  ---
  duration_ms: 1.1074
  type: 'test'
  ...
# Subtest: routeMatches is the honesty check: what is configured against what will be used
ok 145 - routeMatches is the honesty check: what is configured against what will be used
  ---
  duration_ms: 0.6047
  type: 'test'
  ...
# Subtest: only session cookies are selected for carry-over
ok 146 - only session cookies are selected for carry-over
  ---
  duration_ms: 5.6085
  type: 'test'
  ...
# Subtest: malformed cookies are dropped rather than carried into the file
ok 147 - malformed cookies are dropped rather than carried into the file
  ---
  duration_ms: 0.6339
  type: 'test'
  ...
# Subtest: the stored shape is normalised, so a restore always has a usable path and sameSite
ok 148 - the stored shape is normalised, so a restore always has a usable path and sameSite
  ---
  duration_ms: 4.3125
  type: 'test'
  ...
# Subtest: a payload records its version, scope and account
ok 149 - a payload records its version, scope and account
  ---
  duration_ms: 2.4382
  type: 'test'
  ...
# Subtest: a payload for another account is rejected rather than restored
ok 150 - a payload for another account is rejected rather than restored
  ---
  duration_ms: 1.4494
  type: 'test'
  ...
# Subtest: unsupported or absent payloads are rejected
ok 151 - unsupported or absent payloads are rejected
  ---
  duration_ms: 0.8636
  type: 'test'
  ...
# Subtest: a v1 payload (whole cookie jar) is narrowed, never rejected
ok 152 - a v1 payload (whole cookie jar) is narrowed, never rejected
  ---
  duration_ms: 1.0904
  type: 'test'
  ...
# Subtest: a payload round-trips: what is written is what is restored
ok 153 - a payload round-trips: what is written is what is restored
  ---
  duration_ms: 1.0854
  type: 'test'
  ...
# Subtest: a storable list needs no session flag on the way back in
ok 154 - a storable list needs no session flag on the way back in
  ---
  duration_ms: 0.9827
  type: 'test'
  ...
# Subtest: session file names are derived from a validated identifier
ok 155 - session file names are derived from a validated identifier
  ---
  duration_ms: 2.2592
  type: 'test'
  ...
# Subtest: the partition name matches the persisted profile the file belongs to
ok 156 - the partition name matches the persisted profile the file belongs to
  ---
  duration_ms: 1.3281
  type: 'test'
  ...
# Subtest: serial work reuses one warm reader instead of rebuilding it per inspection
ok 157 - serial work reuses one warm reader instead of rebuilding it per inspection
  ---
  duration_ms: 7.0848
  type: 'test'
  ...
# Subtest: concurrent work is spread across the pool up to its size
ok 158 - concurrent work is spread across the pool up to its size
  ---
  duration_ms: 1.0274
  type: 'test'
  ...
# Subtest: work beyond the pool size queues and is served on release, not rejected
ok 159 - work beyond the pool size queues and is served on release, not rejected
  ---
  duration_ms: 12.8043
  type: 'test'
  ...
# Subtest: an idle reader is retired, and a later acquire starts a fresh one
ok 160 - an idle reader is retired, and a later acquire starts a fresh one
  ---
  duration_ms: 75.0316
  type: 'test'
  ...
# Subtest: a queued waiter is not starved by idle retirement
ok 161 - a queued waiter is not starved by idle retirement
  ---
  duration_ms: 88.6624
  type: 'test'
  ...
# Subtest: a failing factory does not poison the pool
ok 162 - a failing factory does not poison the pool
  ---
  duration_ms: 3.9305
  type: 'test'
  ...
# Subtest: closeAll rejects queued work and closes every worker
ok 163 - closeAll rejects queued work and closes every worker
  ---
  duration_ms: 1.1967
  type: 'test'
  ...
# Subtest: a session walks the happy path: idle, launching, loading, ready
ok 164 - a session walks the happy path: idle, launching, loading, ready
  ---
  duration_ms: 7.1479
  type: 'test'
  ...
# Subtest: every state is reachable, and the table only names known states
ok 165 - every state is reachable, and the table only names known states
  ---
  duration_ms: 2.9543
  type: 'test'
  ...
# Subtest: an event that does not apply is refused, and says so
ok 166 - an event that does not apply is refused, and says so
  ---
  duration_ms: 0.7831
  type: 'test'
  ...
# Subtest: a second launch is refused rather than restarting the machine
ok 167 - a second launch is refused rather than restarting the machine
  ---
  duration_ms: 0.4363
  type: 'test'
  ...
# Subtest: the machine owns the deadline for launching and fires stalled
ok 168 - the machine owns the deadline for launching and fires stalled
  ---
  duration_ms: 0.8163
  type: 'test'
  ...
# Subtest: the deadline is re-armed per state and cleared on a state without one
ok 169 - the deadline is re-armed per state and cleared on a state without one
  ---
  duration_ms: 0.6301
  type: 'test'
  ...
# Subtest: an expired deadline cannot fire after the state moved on
ok 170 - an expired deadline cannot fire after the state moved on
  ---
  duration_ms: 0.73
  type: 'test'
  ...
# Subtest: a load failure degrades the session without discarding the reason
ok 171 - a load failure degrades the session without discarding the reason
  ---
  duration_ms: 0.4006
  type: 'test'
  ...
# Subtest: recovery from degraded goes through loading and can reach ready
ok 172 - recovery from degraded goes through loading and can reach ready
  ---
  duration_ms: 0.7834
  type: 'test'
  ...
# Subtest: a responsive window returns a degraded session to ready directly
ok 173 - a responsive window returns a degraded session to ready directly
  ---
  duration_ms: 2.8235
  type: 'test'
  ...
# Subtest: reloading from ready passes through loading rather than jumping
ok 174 - reloading from ready passes through loading rather than jumping
  ---
  duration_ms: 0.8971
  type: 'test'
  ...
# Subtest: closing then closed is the orderly shutdown path
ok 175 - closing then closed is the orderly shutdown path
  ---
  duration_ms: 0.6382
  type: 'test'
  ...
# Subtest: closed is reachable from every live state, because a window can vanish
ok 176 - closed is reachable from every live state, because a window can vanish
  ---
  duration_ms: 1.0768
  type: 'test'
  ...
# Subtest: a closed machine ignores every later event
ok 177 - a closed machine ignores every later event
  ---
  duration_ms: 0.4997
  type: 'test'
  ...
# Subtest: history records each move with its reason and stays bounded
ok 178 - history records each move with its reason and stays bounded
  ---
  duration_ms: 1.174
  type: 'test'
  ...
# Subtest: dispose releases the pending deadline so a closed window cannot fire later
ok 179 - dispose releases the pending deadline so a closed window cannot fire later
  ---
  duration_ms: 0.4483
  type: 'test'
  ...
# Subtest: busy states are exactly the ones the UI must not offer actions in
ok 180 - busy states are exactly the ones the UI must not offer actions in
  ---
  duration_ms: 0.8928
  type: 'test'
  ...
# Subtest: every declared field has a control, and no control describes an undeclared field
ok 181 - every declared field has a control, and no control describes an undeclared field
  ---
  duration_ms: 8.8278
  type: 'test'
  ...
# Subtest: a tab is not a table, and a section is not a control
ok 182 - a tab is not a table, and a section is not a control
  ---
  duration_ms: 1.0289
  type: 'test'
  ...
# Subtest: controls take their label and their bounds from the schema, not from the markup
ok 183 - controls take their label and their bounds from the schema, not from the markup
  ---
  duration_ms: 0.9051
  type: 'test'
  ...
# Subtest: every control id is unique and derived from its path
ok 184 - every control id is unique and derived from its path
  ---
  duration_ms: 0.5218
  type: 'test'
  ...
# Subtest: a control id cannot collide between a path and a field that spells it the same way
ok 185 - a control id cannot collide between a path and a field that spells it the same way
  ---
  duration_ms: 0.4445
  type: 'test'
  ...
# Subtest: typed text becomes the declared type, and a blank control is not an instruction
ok 186 - typed text becomes the declared type, and a blank control is not an instruction
  ---
  duration_ms: 1.3879
  type: 'test'
  ...
# Subtest: a value the control cannot hold is refused by name, not coerced
ok 187 - a value the control cannot hold is refused by name, not coerced
  ---
  duration_ms: 1.338
  type: 'test'
  ...
# Subtest: a field grammar is not re-implemented here: text is passed through untouched
ok 188 - a field grammar is not re-implemented here: text is passed through untouched
  ---
  duration_ms: 0.4522
  type: 'test'
  ...
# Subtest: a route that carries a credential is masked, and the credential is not in the descriptor
ok 189 - a route that carries a credential is masked, and the credential is not in the descriptor
  ---
  duration_ms: 1.4116
  type: 'test'
  ...
# Subtest: nesting and removal are the two operations the controller needs
ok 190 - nesting and removal are the two operations the controller needs
  ---
  duration_ms: 2.4062
  type: 'test'
  ...
# Subtest: nothing here throws, whatever it is handed
ok 191 - nothing here throws, whatever it is handed
  ---
  duration_ms: 6.2772
  type: 'test'
  ...
# Subtest: a valid edit produces the validated state, and the form comes back with it
ok 192 - a valid edit produces the validated state, and the form comes back with it
  ---
  duration_ms: 47.8072
  type: 'test'
  ...
# Subtest: the candidate is merged before it is validated, because requiredness is a property of the whole
ok 193 - the candidate is merged before it is validated, because requiredness is a property of the whole
  ---
  duration_ms: 1.1086
  type: 'test'
  ...
# Subtest: a grammar refusal on a field the user typed is an error, not a drop
ok 194 - a grammar refusal on a field the user typed is an error, not a drop
  ---
  duration_ms: 2.861
  type: 'test'
  ...
# Subtest: a grammar refusal on a field the user did not touch keeps its dropped meaning
ok 195 - a grammar refusal on a field the user did not touch keeps its dropped meaning
  ---
  duration_ms: 0.9851
  type: 'test'
  ...
# Subtest: an error on a section concerns an edit inside it
ok 196 - an error on a section concerns an edit inside it
  ---
  duration_ms: 0.2798
  type: 'test'
  ...
# Subtest: a refusal leaves the stored state alone and the form intact
ok 197 - a refusal leaves the stored state alone and the form intact
  ---
  duration_ms: 0.492
  type: 'test'
  ...
# Subtest: clearing is explicit, and cannot produce an invalid document
ok 198 - clearing is explicit, and cannot produce an invalid document
  ---
  duration_ms: 0.7962
  type: 'test'
  ...
# Subtest: reset returns the declared defaults
ok 199 - reset returns the declared defaults
  ---
  duration_ms: 0.9969
  type: 'test'
  ...
# Subtest: an account's overrides are validated by the account boundary, not the settings one
ok 200 - an account's overrides are validated by the account boundary, not the settings one
  ---
  duration_ms: 2.7977
  type: 'test'
  ...
# Subtest: the form section names come from the mapper, so the controller cannot invent one
ok 201 - the form section names come from the mapper, so the controller cannot invent one
  ---
  duration_ms: 0.3967
  type: 'test'
  ...
# Subtest: shop return requires five stable seconds and fires only once
ok 202 - shop return requires five stable seconds and fires only once
  ---
  duration_ms: 10.548
  type: 'test'
  ...
# Subtest: leaving shop, changing URL or navigating outside official origin cancels pending return
ok 203 - leaving shop, changing URL or navigating outside official origin cancels pending return
  ---
  duration_ms: 0.9207
  type: 'test'
  ...
# Subtest: the backoff doubles, then stops at the cap
ok 204 - the backoff doubles, then stops at the cap
  ---
  duration_ms: 2.6953
  type: 'test'
  ...
# Subtest: an initial health record is empty and not exhausted
ok 205 - an initial health record is empty and not exhausted
  ---
  duration_ms: 2.192
  type: 'test'
  ...
# Subtest: a dead renderer degrades the session and schedules a bounded recovery
ok 206 - a dead renderer degrades the session and schedules a bounded recovery
  ---
  duration_ms: 3.8692
  type: 'test'
  ...
# Subtest: firing the recovery timer reloads through the injected mechanism
ok 207 - firing the recovery timer reloads through the injected mechanism
  ---
  duration_ms: 1.4067
  type: 'test'
  ...
# Subtest: three attempts are made, then the module stops and says so
ok 208 - three attempts are made, then the module stops and says so
  ---
  duration_ms: 1.442
  type: 'test'
  ...
# Subtest: a successful load credits the recovery budget back
ok 209 - a successful load credits the recovery budget back
  ---
  duration_ms: 0.951
  type: 'test'
  ...
# Subtest: an unresponsive renderer is given a grace period before it is acted on
ok 210 - an unresponsive renderer is given a grace period before it is acted on
  ---
  duration_ms: 1.112
  type: 'test'
  ...
# Subtest: a renderer that answers inside the grace period is never degraded
ok 211 - a renderer that answers inside the grace period is never degraded
  ---
  duration_ms: 0.6784
  type: 'test'
  ...
# Subtest: repeated unresponsive events do not stack grace timers
ok 212 - repeated unresponsive events do not stack grace timers
  ---
  duration_ms: 3.1476
  type: 'test'
  ...
# Subtest: a degraded session that answers on its own returns to ready and is credited
ok 213 - a degraded session that answers on its own returns to ready and is credited
  ---
  duration_ms: 2.7225
  type: 'test'
  ...
# Subtest: a responsive event on a healthy session changes nothing
ok 214 - a responsive event on a healthy session changes nothing
  ---
  duration_ms: 0.8417
  type: 'test'
  ...
# Subtest: a failing recovery mechanism is recorded rather than thrown
ok 215 - a failing recovery mechanism is recorded rather than thrown
  ---
  duration_ms: 1.0586
  type: 'test'
  ...
# Subtest: a terminal session ignores renderer events entirely
ok 216 - a terminal session ignores renderer events entirely
  ---
  duration_ms: 0.7229
  type: 'test'
  ...
# Subtest: dispose removes every listener and clears every timer
ok 217 - dispose removes every listener and clears every timer
  ---
  duration_ms: 0.8389
  type: 'test'
  ...
# Subtest: the exit code is reported when the renderer dies without a known reason
ok 218 - the exit code is reported when the renderer dies without a known reason
  ---
  duration_ms: 0.3927
  type: 'test'
  ...
# Subtest: both sources compile into one chronological stream
ok 219 - both sources compile into one chronological stream
  ---
  duration_ms: 7.1307
  type: 'test'
  ...
# Subtest: a transition recorded in the same millisecond as an activity entry comes first
ok 220 - a transition recorded in the same millisecond as an activity entry comes first
  ---
  duration_ms: 0.6955
  type: 'test'
  ...
# Subtest: severity comes from the state machine, not from a second list
ok 221 - severity comes from the state machine, not from a second list
  ---
  duration_ms: 0.8686
  type: 'test'
  ...
# Subtest: the bound keeps the newest entries
ok 222 - the bound keeps the newest entries
  ---
  duration_ms: 1.5083
  type: 'test'
  ...
# Subtest: queries filter and compose
ok 223 - queries filter and compose
  ---
  duration_ms: 1.105
  type: 'test'
  ...
# Subtest: failures are the warnings, in order
ok 224 - failures are the warnings, in order
  ---
  duration_ms: 0.7261
  type: 'test'
  ...
# Subtest: the summary counts both sources, and measures the span
ok 225 - the summary counts both sources, and measures the span
  ---
  duration_ms: 1.2239
  type: 'test'
  ...
# Subtest: the index answers which account, which event, which transitions
ok 226 - the index answers which account, which event, which transitions
  ---
  duration_ms: 0.9752
  type: 'test'
  ...
# Subtest: redaction removes names from the field and from the message
ok 227 - redaction removes names from the field and from the message
  ---
  duration_ms: 2.7576
  type: 'test'
  ...
# Subtest: redaction survives a name that looks like a pattern
ok 228 - redaction survives a name that looks like a pattern
  ---
  duration_ms: 2.2206
  type: 'test'
  ...
# Subtest: the view is what crosses IPC, and redaction is declared in it
ok 229 - the view is what crosses IPC, and redaction is declared in it
  ---
  duration_ms: 1.4587
  type: 'test'
  ...
# Subtest: nothing here throws, whatever it is handed
ok 230 - nothing here throws, whatever it is handed
  ---
  duration_ms: 2.7539
  type: 'test'
  ...
# Subtest: a transition with a missing timestamp does not corrupt the order
ok 231 - a transition with a missing timestamp does not corrupt the order
  ---
  duration_ms: 0.4434
  type: 'test'
  ...
# Subtest: a closed account is redacted by name even though no entry carries it
ok 232 - a closed account is redacted by name even though no entry carries it
  ---
  duration_ms: 0.6168
  type: 'test'
  ...
# Subtest: the corpus is well formed
ok 233 - the corpus is well formed
  ---
  duration_ms: 3.2165
  type: 'test'
  ...
# Subtest: every state the rule engine can produce is covered, and the negatives are present
ok 234 - every state the rule engine can produce is covered, and the negatives are present
  ---
  duration_ms: 1.0778
  type: 'test'
  ...
# Subtest: every frame classifies as the state it claims, through the pipeline
ok 235 - every frame classifies as the state it claims, through the pipeline
  ---
  duration_ms: 3.2424
  type: 'test'
  ...
# Subtest: the corpus is self-describing about clipping
ok 236 - the corpus is self-describing about clipping
  ---
  duration_ms: 0.3339
  type: 'test'
  ...
# Subtest: every box maps inside its frame, and the mapping round-trips
ok 237 - every box maps inside its frame, and the mapping round-trips
  ---
  duration_ms: 0.5456
  type: 'test'
  ...
# Subtest: the bottom band matches the ratio the recogniser depends on
ok 238 - the bottom band matches the ratio the recogniser depends on
  ---
  duration_ms: 0.718
  type: 'test'
  ...
# Subtest: low-confidence telemetry survives into the grid
ok 239 - low-confidence telemetry survives into the grid
  ---
  duration_ms: 0.3609
  type: 'test'
  ...
# Subtest: the measured limitation this corpus exists to justify
ok 240 - the measured limitation this corpus exists to justify
  ---
  duration_ms: 0.2916
  type: 'test'
  ...
# Subtest: the corpus states its own limitations
ok 241 - the corpus states its own limitations
  ---
  duration_ms: 0.4876
  type: 'test'
  ...
# Subtest: a region converts to a capture rect, refusing rather than guessing
ok 242 - a region converts to a capture rect, refusing rather than guessing
  ---
  duration_ms: 8.0502
  type: 'test'
  ...
# Subtest: the origin is floored and an extent never rounds away to nothing
ok 243 - the origin is floored and an extent never rounds away to nothing
  ---
  duration_ms: 0.4518
  type: 'test'
  ...
# Subtest: converting back returns page coordinates
ok 244 - converting back returns page coordinates
  ---
  duration_ms: 0.6052
  type: 'test'
  ...
# Subtest: clipping a rectangle to its bounds reports, and refuses only when nothing is left
ok 245 - clipping a rectangle to its bounds reports, and refuses only when nothing is left
  ---
  duration_ms: 0.8711
  type: 'test'
  ...
# Subtest: the achieved capture density is reported, not assumed
ok 246 - the achieved capture density is reported, not assumed
  ---
  duration_ms: 0.8518
  type: 'test'
  ...
# Subtest: a frame describes itself in one line
ok 247 - a frame describes itself in one line
  ---
  duration_ms: 0.4303
  type: 'test'
  ...
# Subtest: the pipeline has a stage before the image exists and a stage after it
ok 248 - the pipeline has a stage before the image exists and a stage after it
  ---
  duration_ms: 1.4499
  type: 'test'
  ...
# Subtest: a pipeline refuses the same inputs the frame rules refuse
ok 249 - a pipeline refuses the same inputs the frame rules refuse
  ---
  duration_ms: 0.6096
  type: 'test'
  ...
# Subtest: handles derive the crops from the image, including the ratio the recogniser depends on
ok 250 - handles derive the crops from the image, including the ratio the recogniser depends on
  ---
  duration_ms: 1.174
  type: 'test'
  ...
# Subtest: lines become positioned cells, in reading order
ok 251 - lines become positioned cells, in reading order
  ---
  duration_ms: 2.2523
  type: 'test'
  ...
# Subtest: a cell hanging past the edge is clipped and flagged
ok 252 - a cell hanging past the edge is clipped and flagged
  ---
  duration_ms: 0.5227
  type: 'test'
  ...
# Subtest: telemetry counts what the recogniser reported
ok 253 - telemetry counts what the recogniser reported
  ---
  duration_ms: 2.9323
  type: 'test'
  ...
# Subtest: row grouping is a stated ratio, not a coincidence of equal tops
ok 254 - row grouping is a stated ratio, not a coincidence of equal tops
  ---
  duration_ms: 1.3288
  type: 'test'
  ...
# Subtest: text is normalised the way the classifier expects to read it
ok 255 - text is normalised the way the classifier expects to read it
  ---
  duration_ms: 0.4326
  type: 'test'
  ...
# Subtest: an empty grid is a valid grid
ok 256 - an empty grid is a valid grid
  ---
  duration_ms: 0.4511
  type: 'test'
  ...
# Subtest: the grid survives whatever the recogniser hands it
ok 257 - the grid survives whatever the recogniser hands it
  ---
  duration_ms: 2.0091
  type: 'test'
  ...
1..257
# tests 257
# suites 0
# pass 257
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 46306.6051
```

The summary block, reproduced from the end of that same stream:

```text
# tests 257
# suites 0
# pass 257
# fail 0
```

**257 of 257 unit tests pass, 0 fail, 0 skipped, 0 cancelled.**

### 2.2 Test totals — four suites, and they are distinct

Precision matters here, because "257/257" and "desktop integration tests" are not the same measurement:

| Suite | Command | Result | What it proves |
| --- | --- | --- | --- |
| Unit + architecture | `npm test` (inside `verify`) | **257 / 257 pass** | Pure logic: FSM transitions and deadlines, recovery policy arithmetic, identity grammar, route parsing, geometry, profile lifecycle, configuration parity, vision coordinates and corpus, timeline/telemetry/redaction, the generated settings form, and the architecture guards |
| Desktop integration | `npm run test:desktop` | **8 / 8 scenarios pass** | Real Electron: cookie-jar isolation, real canvas capture through local OCR, per-session identity read back from `navigator`/`Intl`, profile lifecycle against real storage, live public-IP check, the settings contract through the real IPC bridge, the diagnostics payload scan, and the Activity timeline rendering |
| Cross-restart persistence | `npm run test:persistence` | **2 / 2 pass** (seed + verify) | Two separate Electron processes: cookies, session cookies and `localStorage` survive a full restart, per account |
| Packaged binary | `Poolside.exe --self-test` | **8 / 8 pass**, exit 0 | The same desktop scenarios against the *packaged* build |

**Total executed checks this run: 275 — 257 unit, 8 desktop, 2 persistence, 8 packaged.**

### 2.3 Raw output of the remaining pipeline stages

Each stage was also run on its own so its output can be quoted exactly. Lint and typecheck produce no findings; the only lines are npm's own banner.

`npm run lint` — exit 0:

```text
> poolside@0.1.0 lint
> eslint .
```

`npm run typecheck` — exit 0:

```text
> poolside@0.1.0 typecheck
> tsc --noEmit
```

`npm run format:check` — exit 0:

```text
> poolside@0.1.0 format:check
> prettier --check "src/**/*.{cjs,js,css,html}" "test/**/*.cjs" "*.md" "docs/**/*.md"

Checking formatting...
All matched files use Prettier code style!
```

### 2.4 The 200-line ceiling

Measured with the ceiling test's own metric — `content.split('\n').length`, which counts one more than `wc -l` for a file ending in a newline. Quoting the enforced rule from `test/architecture.test.cjs`:

```js
const MAX_MODULE_LINES = 200;
// ...
test('no source module exceeds the modularity ceiling', () => {
  const oversized = sourceFiles()
    .map(name => ({ name, lines: read(name).split('\n').length }))
    .filter(entry => entry.lines > MAX_MODULE_LINES);
  assert.deepEqual(oversized, [], `modules over ${MAX_MODULE_LINES} lines must be split`);
});
```

| Metric | Value |
| --- | --- |
| Modules measured | **61** |
| Modules over the ceiling | **0** |
| Total source lines | **7,432** (mean 121.8) |
| Largest module | `workspace.cjs` — **200 lines, exactly at the ceiling**, one line from a required extraction |
| Next largest | `profile-manager.cjs` 198, `main.cjs` 194, `proxy.cjs` 191, `profile-diagnostics.cjs` 190, `windows.cjs` 188 |

The ceiling has fired nine times across the project and has never been relaxed — every breach was resolved by extracting a module along a question boundary: `self-test.cjs` (213), `footprint.cjs` (234), `windows.cjs` (252 → 262 after a Prettier pass), `profile-integrity.cjs`, `config-validator.cjs` (251), `profile-manager.cjs` (205), `timeline-engine.cjs` (228), `dashboard-telemetry.cjs` (326), and `settings-form-mapper.cjs` (273). Complete per-module measurements follow.

**61 modules · 7432 lines · mean 121.8 · largest 200 (`workspace.cjs`) · 0 over the 200-line ceiling**

| Module | Lines | Headroom to 200 | 
| --- | ---: | ---: |
| `workspace.cjs` | 200 | 0 |
| `profile-manager.cjs` | 198 | 2 |
| `main.cjs` | 194 | 6 |
| `proxy.cjs` | 191 | 9 |
| `profile-diagnostics.cjs` | 190 | 10 |
| `windows.cjs` | 188 | 12 |
| `config-schema.cjs` | 185 | 15 |
| `vision-grid.cjs` | 183 | 17 |
| `self-test-footprint.cjs` | 181 | 19 |
| `vision-frame.cjs` | 180 | 20 |
| `ipc.cjs` | 172 | 28 |
| `footprint.cjs` | 170 | 30 |
| `supervision.cjs` | 169 | 31 |
| `telemetry-redaction.cjs` | 169 | 31 |
| `session-fsm.cjs` | 166 | 34 |
| `settings-form-mapper.cjs` | 166 | 34 |
| `config-walk.cjs` | 162 | 38 |
| `profile-integrity.cjs` | 161 | 39 |
| `self-test.cjs` | 158 | 42 |
| `dashboard-telemetry.cjs` | 156 | 44 |
| `geometry.cjs` | 154 | 46 |
| `model.cjs` | 153 | 47 |
| `identity-fields.cjs` | 145 | 55 |
| `profile-paths.cjs` | 145 | 55 |
| `self-test-fixtures.cjs` | 142 | 58 |
| `types.cjs` | 138 | 62 |
| `timeline-engine.cjs` | 133 | 67 |
| `game-screen.cjs` | 132 | 68 |
| `settings-ui-controller.cjs` | 131 | 69 |
| `self-test-profiles.cjs` | 130 | 70 |
| `saved-session.cjs` | 129 | 71 |
| `session-cookies.cjs` | 127 | 73 |
| `inspection.cjs` | 123 | 77 |
| `settings-form-values.cjs` | 122 | 78 |
| `screen-reader-pool.cjs` | 113 | 87 |
| `identity.cjs` | 110 | 90 |
| `config-validator.cjs` | 109 | 91 |
| `profile-sweep.cjs` | 104 | 96 |
| `timeline-query.cjs` | 102 | 98 |
| `vision-pipeline.cjs` | 101 | 99 |
| `plist.cjs` | 93 | 107 |
| `timeline-transfer.cjs` | 93 | 107 |
| `profile-removal.cjs` | 92 | 108 |
| `recovery.cjs` | 89 | 111 |
| `hardening.cjs` | 88 | 112 |
| `profiles.cjs` | 85 | 115 |
| `game-region.cjs` | 82 | 118 |
| `target-identity.cjs` | 75 | 125 |
| `session-window.cjs` | 71 | 129 |
| `recovery-policy.cjs` | 66 | 134 |
| `session-config.cjs` | 63 | 137 |
| `display-geometry.cjs` | 60 | 140 |
| `profile-repair.cjs` | 59 | 141 |
| `layout.cjs` | 57 | 143 |
| `session-events.cjs` | 57 | 143 |
| `state.cjs` | 55 | 145 |
| `shop-recovery.cjs` | 45 | 155 |
| `window-arrange.cjs` | 40 | 160 |
| `network.cjs` | 38 | 162 |
| `preload.cjs` | 26 | 174 |
| `errors.cjs` | 16 | 184 |


### 2.5 Packaged build verification

| Item | Value |
| --- | --- |
| Artifact | `poolside/release/Poolside-win32-x64/Poolside.exe` |
| Built with | `electron-packager`, Electron v44.4.1, `--asar.unpackDir=node_modules` |
| Self-test | **8 PASS, exit 0** |
| Freshness | Rebuilt after the last change to `src/`; the only commits since are documentation, so the binary matches HEAD's source |

Dropping `--asar.unpackDir` breaks native `sharp`/`tesseract.js` inside the package while the dev build hides the problem — which is why the packaged self-test is run rather than assumed.

---

## 3. ARCHITECTURAL PLATFORM MILESTONE SIGN-OFF

### 3.1 What is signed off, and on what evidence

The programmatic baseline built across **Milestones 0 through 5 is present on disk, committed, and structurally verified** on this machine. Each subsystem below is signed off against the tests that hold it, not against intent:

| Milestone | Subsystem | Verified by |
| --- | --- | --- |
| **M0** | CommonJS main process, single IPC contract with one trust guard, error taxonomy, session-storage authority, Electron pinning, local-only telemetry rule, module ceiling and architecture guards | `architecture.test.cjs`, `model.test.cjs`, desktop IPC assertions |
| **M1** | **Event-driven Session FSM** — `idle → launching → loading → ready → degraded → closing → closed`, single writer of session state, FSM-owned deadlines (30 s / 45 s), 50-transition history per session | `session-fsm.test.cjs` (deadline expiry, inapplicable-event refusal, terminal `closed`) |
| **M1** | **Crash & Stall Supervisor** — `render-process-gone` / `unresponsive` handling with exponential backoff (1,500 ms base, doubling, 30 s cap, 3 attempts) and a health record that reaches the dashboard | `supervision.test.cjs` (259 lines, deterministic with injected timers) |
| **M1** | **Profile Identity isolation** — per-session identity and route footprint applied in two halves, 5 CDP overrides, applied values read back out of the running page, isolation asserted between sessions | `identity.test.cjs`, `proxy.test.cjs`, `geometry.test.cjs`, desktop identity + footprint scenarios |
| **M1** | **Profile lifecycle** — establish, generation tracking, integrity verdicts, quarantine-only repair, deletion refused while open, bounded diagnostics | `profile-*.test.cjs` (4 suites), desktop profile-lifecycle scenario |
| **M2** | **Validation schemas** — one declaration of the configuration surface, a walker owning the errors-vs-dropped rule, the boundary validator, schema-first enforcement at both save and launch | `config.test.cjs` — declaration parity, storage round-trip, and a 21-value corpus asserted verdict-for-verdict against the legacy path |
| **M3** | **Vision foundations** — capture coordinate ownership across four coordinate systems, clipping rules, achieved-density verification, structured recognition grid, 15-frame fixture corpus | `vision-pipeline.test.cjs`, `vision-corpus.test.cjs`, desktop canvas-capture scenario |
| **M4** | **Telemetry platform** — diagnostic timeline compiled from two bounded histories, sensitivity-layered metrics, redaction plus a scan that refuses a dirty payload | `timeline-engine.test.cjs`, `dashboard-telemetry.test.cjs`, desktop diagnostics scenario |
| **M5** | **Metadata form mappers** — settings controls generated from the configuration schema, typed form-input pipeline, per-field refusals, masked credential handling | `settings-form.test.cjs`, desktop settings-contract scenario |

### 3.2 Development phase status — stated precisely

The **backend/infrastructure build scoped by Milestones 0 through 5 is complete, committed, and green**: 61 modules, 7,432 lines, zero modules over the ceiling, 275 executed checks passing across four suites, a packaged binary that self-tests clean, and 17 ADRs recording the decisions behind it.

Two qualifications belong in a signed record rather than being left to inference:

**1. "Complete" applies to the code that exists, not to every criterion those milestones named.** The following remain opens, each already tracked as a row in `docs/architecture.md` §13 and §5.4 of `PROJECT_HANDOFF.md`:

| Remainder | Why it is not closed |
| --- | --- |
| Labelled frame corpus (≥ 300 frames) and measured recognition accuracy | ADR-0002's criterion 1 is unmet; the 15-frame corpus is derived layouts, not ground truth, and ADR-0002 correctly remains `Accepted (provisional)` |
| Recognition grid wired into the classifier | Blocked on the measurement above — changing what the classifier reads without it would be unjustified |
| Region ranking validated against the live site | Needs one live pass from the user |
| Durable logs, diagnostics bundle file, frame timings, crash reporting to disk | M4 remainder; the collation, ordering and redaction floor they assemble through already exist and are tested |
| Design tokens, component kit, i18n + extraction test, full accessibility audit, command palette, per-session detail view, click→paint budget | M5's acceptance criteria are **not** met and its exit gate (*a first-time user opens, arranges and understands 8 sessions unaided*) is unverified — it needs a human, not a test |
| Account-override UI | The mapper and controller support the section and it is tested; no view renders it yet |
| Fault injection, soak results, reproducible build, signing/updater, threat model/SBOM, performance budgets | Milestones M6–M9, not started |
| CI | Needs a GitHub remote (a hand-off item) |

**2. Verification is 100% green for what is built and tested — and that is a different claim from "the system is 100% verified."** No accuracy threshold has been measured against labelled data, no latency series has been recorded on a reference machine, and no soak has been run. Those are properties of the whole product rather than of the code, and they are unmeasured rather than passing.

### 3.3 Scope note on downstream use

The platform's own scope boundary is recorded, element by element, in `BOUNDARIES.md` §3.1–3.8 and `docs/adr/0011-operational-scope-boundaries.md` §11.1–11.8, and it did not change for this sign-off. What this document certifies is the substrate: isolated per-account sessions, an honest lifecycle, measured configuration, coordinate ownership, and a telemetry layer that refuses to export what it should not. Input emission into a live game surface, coordination between accounts, and match-outcome manipulation are not built, not verified, and not mapped — the read-only integration surface is documented in §5.3 of `PROJECT_HANDOFF.md`, and the injection points are not.

An external layer that **observes** — reading session state, health, telemetry, diagnostics payloads, and coordinate/geometry output — has a documented, tested, contract-stable surface to build against. An external layer that **acts on the game** is a decision for whoever writes and operates it, and I have not built it or provided the map for it.

### 3.4 Reproducing this document's results

```bash
cd poolside
npm run verify            # lint + typecheck + 257 unit tests   → 257/257
npm run lint              # → exit 0, no findings
npm run typecheck         # → exit 0, no findings
npm run format:check      # → exit 0, "All matched files use Prettier code style!"
npm run test:desktop      # → 8 scenarios PASS
npm run test:persistence  # → seed + verify PASS
npm run package           # rebuild release/ (gitignored; goes stale with every src change)
./release/Poolside-win32-x64/Poolside.exe --self-test   # → 8 PASS, exit 0
```

Operational notes for whoever runs this next: a stray `electron.exe` holds the single-instance lock and makes the next Electron run hang (`taskkill //F //IM electron.exe` clears it); the app exits before a piped `tail` can see a stack trace, so capture output to a file; and the repository lives in OneDrive, where sync can lock `.git` mid-operation.

---

*Signed off at `bf28e9564c962e40500005dc930c4b00892de5c1` — track the hash, not the date. This document was produced from that tree and committed immediately afterwards, so `git log` shows a HEAD one commit ahead of the hash above; no source, test or packaging input changed in the commit that added this file.*
