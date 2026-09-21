# Live recognition validation runbook

This procedure turns Capture Lab records into reproducible evidence for Poolside's game-surface selection,
screen recognition, and local performance. It does not send gameplay input and it does not upload captures.

## Safety and data handling

- Use only screens you are allowed to inspect and label.
- Before every capture, confirm that no password, sign-in field, token, private message, or other sensitive
  information is visible.
- Keep `%APPDATA%/Poolside/recognition-lab/` local. Do not commit its images or manifest.
- Share only the aggregate validation output. It contains counts, rates, gates, and timings—not pixels or account
  details.
- Delete any questionable sample in Capture Lab immediately.

## Build the two sets

Use **Evidence** while developing or changing the recognizer. Evidence helps expose missing labels and review
mistakes, but it never counts toward the production gate.

To inspect table-name development progress without changing any images or labels, run
`npm run analyze:tables`. It reports original capture-time detections and a leave-one-out visual
comparison using reviewed local Evidence. That comparison is useful for debugging but is **not**
independent accuracy proof; the production gate below still uses separate held-out Benchmark images.

After a recognizer change, run `npm run replay:evidence` to check a bounded cross-section of the
reviewed Evidence images using both the first OCR pass and the current complete pipeline. Use
`npm run replay:evidence -- --all` to process every reviewed Evidence image. The report prints only
aggregate screen matches, per-stage use counts, and timing percentiles; it does not modify or print capture images, OCR text, account
details, or sample identifiers. Its table-name result is an **in-sample diagnostic** because the
visual assist can use those same Evidence images as references. Never use this replay as a
substitute for the frozen held-out Benchmark gate.

Development-only experiments can use `--max-width=800` or `--panel-probe` with `--all` to measure
resized full frames or a central-card OCR crop. They never modify stored images, but neither method
is used in the production reader: the reviewed Evidence replay found lost promotion or table
screens. `--compare-readings` checks whether first-pass and complete-pipeline reading values agree
without printing those values; it supported the Shop-only second-pass shortcut. Timing runs should
be repeated without concurrent OCR or packaging work and recorded with the machine configuration.

The 2026-09-21 pixel-equivalent contrast-buffer/PNG-effort change retained 113/113 screen labels and
65/65 table names in the full reviewed Evidence replay. Current-pipeline p95 was 2,122 ms, with
first-pass OCR alone at 1,672 ms p95 and active contrast preparation at 53 ms p95. This is an
in-sample development diagnostic, not an improvement claim for the frozen Benchmark or the live
capture gate. The previously recorded 2,229 ms capture-plus-OCR Benchmark p95 is historical and
cannot change merely by editing code; collect new independent, timed validation only after the
reader is frozen. Further work must address the first OCR pass and capture latency without losing
screen, table, or numeric-reading correctness.

A subsequent 2026-09-21 read-only fast-pass investigation did not justify a production change.
The central-card crop recognized the table-selection gate on 51/65 reviewed Evidence table
images (OCR p95 467 ms); a 1,000-pixel full-frame replay matched 26/28 screen labels on the
bounded Evidence slice (pipeline p95 2,992 ms). Neither preserved the current 113/113 label
result, so neither was wired into the reader. A fresh unchanged-reader full Evidence replay
matched 113/113 labels and 65/65 table names with pipeline p95 1,772 ms and first-OCR-stage
p95 1,479 ms. This difference from the earlier 2,122 ms Evidence run is run-to-run variation,
not a demonstrated optimization. The stored held-out Benchmark timing gate remains 2,229 ms.

Use **Benchmark** only for held-out captures that were not used to choose phrases, thresholds, crops, or other
recognition rules. Once a benchmark run starts, freeze the code and benchmark set until the report is recorded.
If a benchmark image changes the implementation, move it back to Evidence and collect a new held-out image from
a later session.

The target collection is 300 independent benchmark images across the seven real screen labels:

| Expected label  | Capture target | Representative conditions                                                             |
| --------------- | -------------- | ------------------------------------------------------------------------------------- |
| loading         | 40             | Early, middle, and late loading; small label; different window sizes                  |
| connecting      | 40             | Fresh launches and reconnects; short and long waits                                   |
| lucky-promotion | 40             | Promotion entry, settled dialog, and varied backgrounds                               |
| lucky-shot      | 40             | Entry and ready states at different window sizes                                      |
| lobby           | 40             | Different visible lobby panels, balances, and non-sensitive account states            |
| table-selection | 60             | At least three captures labeled for every supported table, at varied scroll positions |
| shop            | 40             | Official shop landing and representative non-sensitive sections                       |

`blank`, `error`, and `unknown` are not screen labels and must not appear in the manifest. A failed classification
is reported as an `unrecognized` outcome against one of the seven real expected screens.

Across each label, vary at least three window sizes, two Windows display-scale settings where hardware allows,
and more than one application launch. Do not manufacture uniqueness by moving an unchanged window or recapturing
the same frozen frame. Capture Lab rejects an identical image under the same label; the production gate also
rejects duplicate hashes anywhere in the benchmark.

## Validate surface selection first

Before saving a recognition sample, use **Inspect game** and confirm that the highlighted/captured region is the
actual game surface. For each label and window-size combination, record the date, Windows scale, viewport size,
number of visible candidate surfaces, selected surface, and whether the choice was correct. Include pages with
multiple canvases/iframes and at least one expected failure with no usable surface.

Do not add a wrongly selected region to the recognition benchmark. Treat it as a surface-selection defect, save
the non-sensitive diagnostic details, and fix or characterize it before continuing that row of the matrix.

## Production corpus gate

Capture Lab shows the gate live. The same aggregate report is available from PowerShell:

```powershell
npm run validate:corpus -- "$env:APPDATA\Poolside\recognition-lab"
```

Add `--json` to produce machine-readable aggregate output. Exit code `0` means every gate passed, `1` means the
corpus is valid but not ready, and `2` means the manifest could not be read.

| Gate                     | Required result                                     |
| ------------------------ | --------------------------------------------------- |
| Held-out benchmark       | At least 300 samples                                |
| Per-label coverage       | At least 20 samples for every supported label       |
| Per-table coverage       | At least 3 table-selection samples per table        |
| Independence             | No duplicate or missing image hashes                |
| Top-1 accuracy           | At least 97%                                        |
| Macro F1                 | At least 90%; unpredicted supported labels are 0    |
| Table target accuracy    | At least 97%                                        |
| Unrecognized outcomes    | At most 5%                                          |
| Review queue             | No unresolved benchmark disagreements               |
| Timing coverage          | At least 30 total-time measurements                 |
| Capture plus OCR latency | p95 at or below 2,000 ms (provisional local target) |

Record the commit, Poolside and Electron versions, Windows build, CPU, GPU/driver, memory, display scaling,
sample date range, command output, and any exclusions beside the release evidence. A passing corpus report is
recognition evidence only; it does not replace the clean-VM, soak, stretch, GPU-failure, signing, or updater work.
The 2,000 ms target is a local policy change, not proof that the delay is safe for action or that
any currently unavailable game-input capability may be enabled. Approve it only with fresh
capture-to-classification measurements and action-freshness evidence on the declared machine.

## When the gate fails

Review label disagreements before changing code. Delete mislabeled or sensitive captures. Real recognizer misses
stay in the benchmark and should fail the report; do not relabel them to match the detector. If a benchmark result
drives a code change, retire that image to Evidence, collect a fresh held-out replacement, then rerun the full
report on the frozen build.
