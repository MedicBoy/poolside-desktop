# ADR-0002 — Recognition stack: Tesseract + Sharp, revisited at M3

- **Status:** Accepted (provisional — revisit in M3 with the labelled corpus)
- **Date:** 2026-09-18
- **Related:** `src/game-screen.cjs`, `src/screen-reader-pool.cjs`, `test/fixtures/`, roadmap M3

## Context

Screen recognition has to answer one question offline: which of a small set of known screens is
showing? The current answer is bundled Tesseract OCR plus a Sharp contrast pass, with the result
mapped through keyword gates (`classify` in `src/game-screen.cjs`).

That works on the seven available fixtures, but the evidence base is thin: seven positive samples
and no negatives. The roadmap's §0.2 sets a real bar (≥ 97 % top-1, ≥ 0.90 macro-F1, ≤ 800 ms p95),
and it is not yet known whether a text-first approach reaches it — the screens differ as much
structurally (button shapes, table art, overlays) as they do textually.

The decision to keep or replace the stack should follow a measurement, not precede it. What cannot
wait is deciding _what will decide it_, so the choice does not get made by accident when M3 runs
short of time.

## Decision

Keep Tesseract + Sharp as the v1 recognition engine. Treat it as provisional and settle it in M3
against the labelled corpus, using these criteria:

1. **Accuracy** — will it reach ≥ 0.90 macro-F1 on a held-out split of ≥ 300 labelled frames?
2. **Latency** — can capture → classified state stay ≤ 800 ms p95 with the worker pool?
3. **Negative behaviour** — does it return `unknown` rather than a confident wrong answer on the
   negative set (blank frames, mid-load partials, dialogs, the shop, wrong-aspect surfaces,
   non-English)?

If any criterion fails and template/feature matching or a small ONNX classifier measurably beats it,
switch. The classifier's contract (`{state, score, evidence}`) is deliberately engine-agnostic so
that swap is contained in one module.

## Consequences

### Positive

- No new runtime dependency, and nothing to download at runtime.
- The pipeline is already offline and privacy-preserving: only a state label leaves the module.
- A measurable bar means the choice is defensible in either direction.

### Negative / costs

- Tesseract is slow (the pool exists partly because of that) and its accuracy on stylised game
  fonts is unproven — the one frame it cannot read is already documented.
- The keyword gates are English-only and brittle; the corpus must therefore include the negatives
  that expose it.
- A future engine swap invalidates the tuning in `RULES`, though not the tests.

## Alternatives considered

- **Template matching only.** Rejected as the sole engine: it breaks under scaling, theming and
  localisation, though it may still be added as structural evidence alongside OCR.
- **A small trained classifier (ONNX) now.** Rejected: no corpus to train on. Training on seven
  fixtures would produce a model that looks accurate and is not.
- **DOM/JS introspection instead of vision.** Not available: game windows are sandboxed with no
  preload bridge, and reaching into the game's own DOM is out of scope.

## Enforcement

Review only, for now. M3's regression harness is the mechanism: it will fail the build if accuracy
drops below the thresholds above, so whichever engine is in place must hold the bar to stay in.
