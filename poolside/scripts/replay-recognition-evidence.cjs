// Read-only development replay. Never prints OCR text, image data, sample IDs, or local paths.
// Evidence is intentionally NOT an independent benchmark, especially for the table visual assist.
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createWorker, PSM } = require('tesseract.js');
const language = require('@tesseract.js-data/eng');
const sharp = require('sharp');
const { createCaptureLab } = require('../src/capture-lab.cjs');
const { createScreenReader, classify } = require('../src/game-screen.cjs');
const { createTableVisualMatcher } = require('../src/table-visual.cjs');
const { parseVisibleReadings } = require('../src/visible-readings.cjs');
const { cellsFromBlocks, readingsFromCells } = require('../src/reading-regions.cjs');
const { SAMPLE_STATES } = require('../src/capture-manifest.cjs');
const { TABLES } = require('../src/table-list.cjs');

/** @param {any[]} samples @param {{perLabel?: number, perTable?: number, all?: boolean, only?: string[]}} [options] */
function selectEvidence(samples, { perLabel = 2, perTable = 1, all = false, only } = {}) {
  const eligible = samples.filter(
    sample =>
      sample.cohort === 'evidence' &&
      sample.imageAvailable &&
      (sample.reviewedAt || sample.matches) &&
      SAMPLE_STATES.includes(sample.expectedState) &&
      (!only || only.includes(sample.expectedState))
  );
  if (all) return eligible;
  const chosen = [];
  for (const label of SAMPLE_STATES) {
    if (label === 'table-selection') {
      for (const table of TABLES)
        chosen.push(...eligible.filter(sample => sample.expectedState === label && sample.expectedTable === table).slice(0, perTable));
    } else chosen.push(...eligible.filter(sample => sample.expectedState === label).slice(0, perLabel));
  }
  return chosen;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]);
}

function sameReadings(left, right) {
  const keys = [...new Set([...Object.keys(left || {}), ...Object.keys(right || {})])];
  return keys.every(key => left?.[key]?.value === right?.[key]?.value && left?.[key]?.exact === right?.[key]?.exact);
}

function summary(rows) {
  return {
    count: rows.length,
    firstCorrect: rows.filter(row => row.firstState === row.expectedState).length,
    finalCorrect: rows.filter(row => row.finalState === row.expectedState).length,
    firstP50Ms: percentile(
      rows.map(row => row.firstMs),
      0.5
    ),
    firstP95Ms: percentile(
      rows.map(row => row.firstMs),
      0.95
    ),
    finalP50Ms: percentile(
      rows.map(row => row.finalMs),
      0.5
    ),
    finalP95Ms: percentile(
      rows.map(row => row.finalMs),
      0.95
    )
  };
}

const STAGE_KEYS = [
  'firstOcrMs',
  'visualMatchMs',
  'contrastPrepMs',
  'contrastOcrMs',
  'bottomPrepMs',
  'bottomOcrMs',
  'readingsMs',
  'totalMs'
];

function stageSummary(rows) {
  return Object.fromEntries(
    STAGE_KEYS.map(key => {
      const values = rows.map(row => row.stages?.[key]).filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
      const active = values.filter(value => value > 0);
      return [
        key,
        { used: active.length, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95), activeP95Ms: percentile(active, 0.95) }
      ];
    })
  );
}

function panelRect(width, height, wide = false) {
  const dimensions = wide ? { left: 0.18, top: 0.28, width: 0.64, height: 0.5 } : { left: 0.27, top: 0.39, width: 0.46, height: 0.37 };
  return {
    left: Math.floor(width * dimensions.left),
    top: Math.floor(height * dimensions.top),
    width: Math.floor(width * dimensions.width),
    height: Math.floor(height * dimensions.height)
  };
}

/** @param {string} dataRoot @param {{all?: boolean, only?: string[], panelScale?: number, wide?: boolean}} [options] */
async function probePanel(dataRoot, options = {}) {
  const lab = createCaptureLab({ root: dataRoot });
  const samples = selectEvidence(lab.list(), options);
  const worker = await createWorker('eng', 1, {
    langPath: language.langPath,
    gzip: true,
    cacheMethod: 'none',
    logger: () => {},
    errorHandler: () => {}
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '150' });
    const rows = [];
    for (const sample of samples) {
      try {
        const image = Buffer.from(lab.image(sample.id).png, 'base64');
        const size = await sharp(image).metadata();
        const started = performance.now();
        const rect = panelRect(size.width, size.height, options.wide);
        const panelCrop = sharp(image).extract(rect);
        const panel = await (options.panelScale ? panelCrop.resize({ width: Math.round(rect.width * options.panelScale) }) : panelCrop)
          .png()
          .toBuffer();
        const result = await worker.recognize(panel, {}, { text: true });
        rows.push({
          expectedState: sample.expectedState,
          expectedTable: sample.expectedTable,
          state: classify(result.data.text).state,
          ms: performance.now() - started
        });
      } catch {
        // Unreadable images are reported, never quietly treated as recognizer misses.
      }
    }
    return { rows, attempted: samples.length };
  } finally {
    await worker.terminate();
  }
}

function printPanelProbe({ rows, attempted }) {
  const table = rows.filter(row => row.expectedState === 'table-selection');
  const other = rows.filter(row => row.expectedState !== 'table-selection');
  console.log('Read-only central-card OCR probe on Evidence only; not a production or held-out accuracy result.');
  console.log(
    `Readable ${rows.length}/${attempted}; table gate ${table.filter(row => row.state === 'table-selection').length}/${table.length}; other-screen false table gates ${other.filter(row => row.state === 'table-selection').length}/${other.length}.`
  );
  console.log(
    `Crop plus OCR p50/p95 ${
      percentile(
        rows.map(row => row.ms),
        0.5
      ) ?? 'n/a'
    }/${
      percentile(
        rows.map(row => row.ms),
        0.95
      ) ?? 'n/a'
    } ms.`
  );
}

/** @param {string} dataRoot @param {{perLabel?: number, perTable?: number, all?: boolean, only?: string[], maxWidth?: number, compareReadings?: boolean}} [options] */
async function replay(dataRoot, options = {}) {
  const lab = createCaptureLab({ root: dataRoot });
  const samples = selectEvidence(lab.list(), options);
  if (!samples.length) return { rows: [], attempted: 0, unreadable: 0 };
  const matcher = createTableVisualMatcher({ references: () => lab.tableReferences() });
  await matcher.warm();
  const firstWorker = await createWorker('eng', 1, {
    langPath: language.langPath,
    gzip: true,
    cacheMethod: 'none',
    logger: () => {},
    errorHandler: () => {}
  });
  let reader;
  try {
    await firstWorker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '150' });
    reader = await createScreenReader({ tableMatcher: matcher });
    const rows = [];
    let unreadable = 0;
    for (const sample of samples) {
      try {
        const original = Buffer.from(lab.image(sample.id).png, 'base64');
        const image = options.maxWidth
          ? await sharp(original).resize({ width: options.maxWidth, withoutEnlargement: true }).png().toBuffer()
          : original;
        const firstStarted = performance.now();
        const first = await firstWorker.recognize(image, {}, { text: true, blocks: Boolean(options.compareReadings) });
        const firstMs = performance.now() - firstStarted;
        const finalStarted = performance.now();
        const final = await reader.inspect(image);
        const finalMs = performance.now() - finalStarted;
        const size = options.compareReadings ? await sharp(image).metadata() : null;
        const firstReadings = size
          ? {
              ...parseVisibleReadings(first.data.text, 'replay', Number(first.data.confidence) / 100),
              ...readingsFromCells(cellsFromBlocks(first.data.blocks), { width: size.width, height: size.height }, 'replay')
            }
          : null;
        rows.push({
          expectedState: sample.expectedState,
          expectedTable: sample.expectedTable,
          firstState: classify(first.data.text).state,
          finalState: final.state,
          // The matcher can see this same Evidence image. This is diagnostic only, not validation.
          finalTable: final.tableMatch?.table || null,
          ...(firstReadings && {
            sameReadings: sameReadings(firstReadings, final.readings),
            firstReadingCount: Object.keys(firstReadings).length,
            finalReadingCount: Object.keys(final.readings).length
          }),
          firstMs,
          finalMs,
          stages: final.stages
        });
      } catch {
        // A corrupt or missing image is not counted as a recognizer result, but is visible in the report.
        unreadable++;
      }
    }
    return { rows, attempted: samples.length, unreadable };
  } finally {
    await Promise.allSettled([firstWorker.terminate(), reader?.close()]);
  }
}

function printReport({ rows, attempted, unreadable }) {
  console.log('Read-only Evidence replay; no Benchmark images used. Not independent accuracy or release proof.');
  const all = summary(rows);
  console.log(
    `Replayed ${all.count}/${attempted} images; ${unreadable} unreadable. First OCR screen matches ${all.firstCorrect}; current pipeline ${all.finalCorrect}.`
  );
  console.log(
    `First OCR p50/p95 ${all.firstP50Ms ?? 'n/a'}/${all.firstP95Ms ?? 'n/a'} ms; current pipeline ${all.finalP50Ms ?? 'n/a'}/${all.finalP95Ms ?? 'n/a'} ms.`
  );
  for (const [name, subset] of [
    ['All screens', rows],
    ['Table selection', rows.filter(row => row.expectedState === 'table-selection')]
  ]) {
    if (!subset.length) continue;
    const stages = stageSummary(subset);
    console.log(`${name} stage p50/p95 (ms; use count / ${subset.length}; stage percentiles are not additive):`);
    for (const key of STAGE_KEYS) {
      const stage = stages[key];
      console.log(
        `  ${key}: ${stage.p50Ms ?? 'n/a'}/${stage.p95Ms ?? 'n/a'}; ${stage.used} used; active p95 ${stage.activeP95Ms ?? 'n/a'}`
      );
    }
  }
  for (const label of SAMPLE_STATES) {
    const subset = rows.filter(row => row.expectedState === label);
    if (!subset.length) continue;
    const metrics = summary(subset);
    console.log(
      `${label}: ${metrics.count} images; first ${metrics.firstCorrect}; current ${metrics.finalCorrect}; current p95 ${metrics.finalP95Ms} ms.`
    );
    if (subset.some(row => typeof row.sameReadings === 'boolean'))
      console.log(
        `  Reading comparison: ${subset.filter(row => row.sameReadings).length}/${subset.length} unchanged; first-pass nonempty ${subset.filter(row => row.firstReadingCount).length}; full-pipeline nonempty ${subset.filter(row => row.finalReadingCount).length}.`
      );
  }
  const tables = rows.filter(row => row.expectedState === 'table-selection');
  if (tables.length)
    console.log(
      `Table name in-sample diagnostic: ${tables.filter(row => row.finalState === 'table-selection' && row.finalTable === row.expectedTable).length}/${tables.length}; evaluate with fresh held-out captures before any production claim.`
    );
}

async function main(args) {
  if (args.includes('--help')) {
    console.log(
      'Usage: npm run replay:evidence -- [--all] [--only=loading,shop] [--max-width=800] [--compare-readings] [--panel-probe] [--panel-wide] [--panel-scale=1.5] [Poolside-user-data-directory]'
    );
    return;
  }
  const root = args.find(arg => !arg.startsWith('--')) || (process.env.APPDATA && path.join(process.env.APPDATA, 'Poolside'));
  if (!root) throw new Error('Pass the Poolside user-data directory.');
  const only = args
    .find(arg => arg.startsWith('--only='))
    ?.slice('--only='.length)
    .split(',');
  if (args.includes('--panel-probe')) {
    const scaleArg = args.find(arg => arg.startsWith('--panel-scale='));
    const panelScale = scaleArg ? Number(scaleArg.slice('--panel-scale='.length)) : undefined;
    if (panelScale !== undefined && (!(panelScale >= 1) || panelScale > 3)) throw new Error('Choose a panel scale between 1 and 3.');
    if (panelScale) console.log(`Experimental central-card enlargement: ${panelScale}x.`);
    const report = await probePanel(root, { all: args.includes('--all'), only, panelScale, wide: args.includes('--panel-wide') });
    printPanelProbe(report);
    if (!report.attempted || report.rows.length !== report.attempted) process.exitCode = 1;
    return;
  }
  const scale = args.find(arg => arg.startsWith('--max-width='));
  const maxWidth = scale ? Number(scale.slice('--max-width='.length)) : undefined;
  if (maxWidth !== undefined && (!Number.isInteger(maxWidth) || maxWidth < 320 || maxWidth > 1600))
    throw new Error('Choose an integer max width from 320 to 1600.');
  if (maxWidth) console.log(`Experimental OCR input width: at most ${maxWidth} pixels. Production captures remain unchanged.`);
  const report = await replay(root, { all: args.includes('--all'), only, maxWidth, compareReadings: args.includes('--compare-readings') });
  printReport(report);
  if (!report.attempted || report.unreadable) process.exitCode = 1;
}

if (require.main === module)
  main(process.argv.slice(2)).catch(() => {
    console.error('Evidence replay failed; local images and manifest were not changed.');
    process.exitCode = 2;
  });

module.exports = { selectEvidence, percentile, sameReadings, summary, stageSummary, panelRect, probePanel, replay, printReport };
