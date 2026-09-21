# ADR-0002 — Recognition stack: Tesseract + Sharp, revisited at M3

- **Status:** Accepted (provisional — still unsettled: the corpus _harness_ landed in M3, the ≥ 300 labelled
  frames this record's criterion 1 requires did not. See `0015-vision-recognition-processing.md`.)
- **Date:** 2026-09-18
- **Related:** `src/game-screen.cjs`, `src/screen-reader-pool.cjs`, `src/vision-frame.cjs`, `test/fixtures/`, roadmap M3

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

## M3 progress, and what is still unmet

M3 landed the foundations this record depends on and did **not** settle it. Recorded here so the next reader
knows exactly where the evidence stops:

| Criterion                                                          | State after M3's foundations                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. ≥ 0.90 macro-F1 on a held-out split of ≥ 300 labelled frames    | **Cannot be measured.** There are seven recorded fixtures; the corpus added in M3 is 15 _synthetic layouts_ derived from them and from the named failure modes. They drive the matching logic and pin the coordinate rules, and they are explicitly not a labelled frame set.                                     |
| 2. ≤ 800 ms p95 capture → classified                               | Unmeasured. The pool and the timeout exist; no latency series has been recorded on a reference machine (roadmap M9 owns the reference machine).                                                                                                                                                                   |
| 3. `unknown` rather than a confident wrong answer on the negatives | **Partly answered, and the answer is uncomfortable.** The negative classes now exist as fixtures, and the result is that a _single misread gate term_ turns a known screen into `unknown` — see the `scaled-window` frame. The stack does not return a confident wrong answer; it returns an unhelpful right one. |

So the stack stays provisional on evidence, not on preference. Two things would settle it, in order: label real
frames (the seven fixtures plus live captures) to the ≥ 300 the criterion asks for, then run the regression
harness with thresholds. Until then, changing `RULES` would be changing recognition behaviour with no way to
measure the result.

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
  preload bridge. Direct game-DOM integration is not implemented.

## Enforcement

Review only for the engine choice, and it stays review-only until the measurement exists — this record is
provisional and M3 did not settle it, as recorded above. What _is_ enforced now is everything that must hold
whichever engine is in place: the coordinate and boundary rules (ADR-0015, `test/vision-pipeline.test.cjs`),
the corpus's structure, coverage and self-description (`test/vision-corpus.test.cjs`), and the rule engine's
existing behaviour (`test/classification.test.cjs`). The regression harness with accuracy thresholds — the
mechanism this record originally named — is the remaining M3 deliverable, and it needs the labelled corpus
first.
