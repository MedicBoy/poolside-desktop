# ADR-0015 — Vision capture processing: coordinate mapping, transforms and boundary rules

- **Status:** Accepted
- **Date:** 2026-09-18
- **Related:** ADR-0002 (the recognition stack, which this does not settle), ADR-0007 (game-facing test
  strategy), `src/vision-frame.cjs`, `src/vision-grid.cjs`, `src/vision-pipeline.cjs`, `src/inspection.cjs`,
  `src/game-screen.cjs`, `test/fixtures/vision-corpus.json`, roadmap M3
- **Supersedes:** nothing

## Context

Four coordinate systems meet in one capture, and until this record nothing owned their conversion:

| #   | System                | Where it comes from                                                             |
| --- | --------------------- | ------------------------------------------------------------------------------- |
| 1   | page CSS pixels       | `game-region.cjs`'s probe, which measures the surface against the page viewport |
| 2   | capture DIPs          | the rect `webContents.capturePage(rect)` takes                                  |
| 3   | captured image pixels | what the recogniser sees, at the display's device scale factor                  |
| 4   | the resized image     | a fixed 1200 px wide, handed to Tesseract                                       |

`inspection.cjs` carried the 1→2 conversion inline as four `Math.floor(value * zoom)` calls, and
`game-screen.cjs` carried the 3→4 half as `Math.floor(height * 0.8)` and `resize({ width: width * 2 })`. Nothing
checked that the image which came back was the region that had been asked for.

That is the shape of this defect class: **it fails silently and plausibly.** A wrong conversion does not throw,
it crops a different rectangle, and the recogniser then answers confidently from the wrong pixels. The
classifier's output looks like a normal observation, so the wrong answer is indistinguishable from a right one
until someone compares it against the screen. D4 (region location) and D5 (confident wrong answers) both live
next to this, and the roadmap's bar — "never a confident wrong answer" — cannot be met while the coordinates
between measurement and recognition are assumed rather than checked.

M3's other dependencies also stalled here: a corpus of frames is meaningless if the boxes in it are in a
coordinate system nobody can name, which is why this record comes before any change to the classifier.

## Decision

### 15.1 One module owns the conversion

`src/vision-frame.cjs` owns every conversion between systems 1, 2 and 3, and the boundary rules that go with
them. `src/vision-grid.cjs` owns the text structure that comes out of system 3. `src/vision-pipeline.cjs` is the
seam a caller holds: one capture in, a frame plus its transform handles and grid parsing out.

Callers never scale, floor or clamp a coordinate themselves. This is the rule that makes the rest of this
record true rather than aspirational.

### 15.2 Three rounding rules, stated because they are decisions

| Rule                       | Why not the alternative                                                                                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Floor the origin.**      | A crop that starts one pixel late loses text at the region's edge. A term lost at an edge becomes a missing term, a missing term becomes `unknown`, and an `unknown` from a misaligned crop is the one result nobody can debug. Starting early costs nothing. |
| **Round the extent.**      | The region's width is a measurement; rounding it is symmetric and unbiased.                                                                                                                                                                                   |
| **Never below one pixel.** | `sharp.extract()` refuses a zero-sized rectangle, so a caller who has to guard against that will eventually forget to. The rule is enforced at conversion, where it cannot be forgotten.                                                                      |

### 15.3 Two rectangle dialects are named, not translated

Electron's `capturePage` and this module's coordinate functions use `{x, y, width, height}`; `sharp` uses
`{left, top, width, height}`. Both exist, so the transform handles returned by `handles()` are deliberately in
**sharp's** dialect: the object a caller passes to `.extract()` is the object sharp takes. A translation step
between the two is a step that can be applied twice or not at all, and neither failure is visible.

### 15.4 Boundary rules: clip and flag, refuse only when nothing is left

| Situation                                   | Behaviour                          | Why                                                                                                                                                                                                                          |
| ------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Region entirely inside the frame            | unchanged, `clipped: false`        | —                                                                                                                                                                                                                            |
| Region partially outside                    | clipped, `clipped: true`, reported | The probe already clamps to the viewport, so a partial overlap means the surface is partly scrolled out of view. The visible part still carries text; discarding it would be losing a readable screen for a cosmetic reason. |
| Region entirely outside                     | refused, `reason: 'outside-frame'` | An empty crop reaches the recogniser as a blank image and comes back `unknown`, which reads as a recognition failure rather than a measurement one.                                                                          |
| Region with no area, or a non-positive zoom | refused, with a reason             | Same reasoning: the failure must be attributable.                                                                                                                                                                            |

Every refusal carries a machine-readable `reason` **and** a human `message`, so a log line can be grepped and a
user-facing string can be reused. The message is written in page terms, because a rectangle quoted in DIPs is
useless to someone looking at the screen.

### 15.5 The achieved capture density is reported, never assumed

`capturePage` returns an image at the display's device scale factor, so the expected density is
`zoom × deviceScaleFactor`. `checkCapture` compares that with what arrived and, past a 2 % tolerance
(Chromium rounds DIP rects to whole device pixels, so an exact match is unavailable), reports the difference on
the observation.

A density mismatch is **not** a refusal, because the _area_ is still the region that was requested — only the
density differs. What it does change is legibility, so an image captured below the page's own scale is called out
separately: that is the condition under which a small label is misread, and it is otherwise invisible in the
result. `deviceScaleFactor` is injected into `inspection.cjs` from the main process and read at capture time,
never cached, because it changes when a window moves between displays.

### 15.6 Recognised text becomes a positioned grid

A recognition pass is parsed into cells — text, box, confidence, clipped — grouped into rows. Two rules are
stated because both were previously implicit:

- **Reading order** is top-to-bottom, then left-to-right, established once at parse time. Every later consumer
  depends on it, so it is not left to each of them to assume.
- **Row grouping** is a vertical overlap ratio of at least 0.5 against the shorter of the two spans. Equal tops
  would split one visual row whenever the recogniser reports slightly different heights for words on the same
  line, which is normal.

`gridText` is the single place that decides what text the rule engine reads. A change in grid handling cannot
therefore change recognition without changing that one function, which is what makes the corpus meaningful.

### 15.7 The grid is not yet in the recognition path, and that is deliberate

Only the geometry is wired: `inspection.cjs` uses the conversions and the capture check, and `game-screen.cjs`
takes its bottom-band ratio and magnification from the handles. The recogniser still classifies the
concatenation of its two OCR passes, exactly as before.

Changing _what_ the classifier reads — using the grid, or trusting confidence — is changing recognition
behaviour. ADR-0002 requires that decision to be justified by a labelled corpus and a measured accuracy
threshold, and M3 landed the harness without the labels. Wiring the grid in now would be an unmeasured change to
the thing this milestone cannot yet measure, so it is deliberately not done.

### 15.8 Low confidence is counted and reported, never silently trusted

Tesseract reports word confidence 0–100. Tokens below 60 are collected into `telemetry.lowConfidence` and
surfaced on the observation. They are not filtered out of the text the classifier reads — that would be a
recognition change (15.7) — and they are not ignored either. The count is what makes "the recogniser saw it
badly" distinguishable from "the screen did not say it".

### 15.9 The corpus says what it is, and the test enforces that it keeps saying so

`test/fixtures/vision-corpus.json` carries a `disclaimer` stating that its frames are synthetic layouts derived
from the seven recorded fixtures and from the named failure modes — not hand-measured ground truth, and not a
measurement of OCR accuracy. `test/vision-corpus.test.cjs` asserts those phrases survive. This is a small piece of
honesty machinery on purpose: the file's value is easy to overstate, and a corpus that is believed to be
ground truth is worse than no corpus.

### 15.10 There is no canvas abstraction

The pipeline's "rendering surface" is the captured image and its transformations are `extract`/`resize`
arguments. No canvas object, no draw calls, no retained scene: inventing one would be inventing an API with no
consumer, and every frame in this application is captured, transformed once or twice, and discarded.

## Consequences

### Positive

- Every coordinate decision is arithmetic with a test, instead of a claim about a running window.
- A crop that would silently read the wrong pixels now produces a reported note, or a refusal with a reason.
- The band ratio the classifier depends on has one definition; the corpus asserts it.
- The corpus is a harness the next engine (ADR-0002) inherits: structure, coverage, coordinates and clipping are
  already checked, so a replacement engine only has to answer the accuracy question.
- The limitations are measured rather than asserted: the corpus contains a frame demonstrating that one misread
  gate term loses a whole screen.

### Negative / costs

- Three modules where there was inline arithmetic, and four coordinate systems still exist. The conversion is
  centralised; the _complexity_ is not removed, only made visible. That is the trade, and it is worth it here
  because the alternative failure is silent.
- The density check needs `deviceScaleFactor`, which only the main process can read. That is one more injected
  dependency, and a caller that forgets it gets a 1.0 assumption and a note rather than an error.
- The corpus's boxes are plausible, not measured, so a coordinate rule could be correct here and still be
  wrong against a real frame whose layout differs. Only live validation settles that (roadmap M3's remaining
  live pass).
- The grid is built but unused in production (15.7), so it is exercised by tests and by nothing else today —
  dead-ish weight until the classifier work lands. Accepted deliberately: it is the harness that work needs.

## Alternatives considered

- **Keep the conversions inline, at each call site.** Rejected: it is what produced this record, and the
  duplicated `Math.floor(x * zoom)` calls are exactly the ones where a missing factor is invisible.
- **Convert inside the page, before the probe returns.** Rejected: the page cannot know the display scale or
  the capture's density, so it could own only the first conversion while leaving the rest unowned.
- **Treat a density mismatch as a refusal.** Rejected: the captured area is still correct, so refusing would
  discard a usable observation to report a legibility concern. It is a note, always on the observation.
- **Refuse any partially visible region.** Rejected: the probe already clamps to the viewport, so clipping is
  the normal case for a scrolled surface, and refusing it would make an ordinary situation look like an error.
- **Filter low-confidence tokens out of the classifier's text.** Rejected as a recognition change smuggled in
  under a telemetry decision (15.7/15.8). It may well be right, and it needs the measurement first.
- **Model the whole thing as a canvas with transform matrices.** Rejected: no consumer, and a general mechanism
  guessing at future generalisation is how a pipeline becomes unreadable.

## Enforcement

| Rule                                                                               | Enforced by                                                                                        |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Conversion, rounding and refusal rules                                             | `test/vision-pipeline.test.cjs` — floor/round/minimum, each refusal reason, the inverse round trip |
| Clipping behaviour, including the refusal when nothing is left                     | `test/vision-pipeline.test.cjs`                                                                    |
| Density expectations, tolerance and the notes                                      | `test/vision-pipeline.test.cjs`                                                                    |
| Reading order, row grouping ratio, telemetry counts                                | `test/vision-pipeline.test.cjs`                                                                    |
| The band ratio and magnification the classifier depends on                         | `test/vision-pipeline.test.cjs` and `test/vision-corpus.test.cjs`                                  |
| Every corpus box maps inside its frame and round-trips                             | `test/vision-corpus.test.cjs`                                                                      |
| The corpus covers every state, keeps its negatives, and describes its own clipping | `test/vision-corpus.test.cjs`                                                                      |
| The corpus keeps its disclaimer                                                    | `test/vision-corpus.test.cjs`                                                                      |
| The pipeline modules stay Electron-free and under the size ceiling                 | `test/architecture.test.cjs`                                                                       |
| Nothing throws, on any input                                                       | `test/vision-pipeline.test.cjs` — a junk-input corpus                                              |

`npm run verify` must stay green. What this record does **not** enforce is recognition accuracy: that is ADR-0002's
open question, and it needs the labelled corpus.
