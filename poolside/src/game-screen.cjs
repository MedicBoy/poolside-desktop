// Reading a game screen: two OCR passes, the contrast band, the local table matcher, and the verdict they support.
const { createWorker, PSM } = require('tesseract.js');
const language = require('@tesseract.js-data/eng');
const sharp = require('sharp');
const { handles } = require('./vision-pipeline.cjs');
const { parseVisibleReadings } = require('./visible-readings.cjs');
const { readingsFromCells, cellsFromBlocks } = require('./reading-regions.cjs');
const { TABLES } = require('./table-list.cjs');

// Ordered rules. Order encodes precedence, not score: the first state that satisfies its gate
// wins. This matters because real screens overlap — the table selector renders the lobby's
// wording behind it, so table-selection must be evaluated before lobby.
//
// GATE (decides): every `all` term must appear, and if `any` terms are listed at least one must
// appear. A state may have multiple rules for real, reviewed page variants. `hints` never affect
// the gate.
// SCORE (reports): matched weight / total weight, i.e. confidence, not a decision.
// EVIDENCE (reports): the phrases that matched, so an unexpected result is debuggable.
//
// Defect history (D5): the previous classifier was a chain of AND-ed regexes returning a bare
// label — no score, no evidence, so a single missing phrase produced an unrecognized result with nothing to
// inspect. Loosening these gates is an M3 task that must be justified by the labelled corpus.
const RULES = [
  { state: 'shop', all: ['featured'], any: ['web shop exclusive', 'bundle'], hints: ['ultimate', 'windy city'] },
  {
    state: 'shop',
    all: ['daily reward', 'pool pass'],
    any: ['route 66 cue set', 'free daily cue piece', 'weekly deals'],
    hints: ['official page']
  },
  { state: 'shop', all: ['route 66 cue set', 'pool pass'], any: ['weekly deals', 'free daily cue piece'], hints: ['official page'] },
  { state: 'shop', all: ['earn loyalty points', 'exchange points'], any: ['premium content'], hints: ['pool pass', 'official page'] },
  { state: 'shop', all: ['surprise boxes', 'social'], any: ['cash', 'promotions'], hints: ['cues', 'coins'] },
  { state: 'lucky-promotion', all: ['come back every day'], any: ['play free'], hints: ['gold ball', 'free reward'] },
  { state: 'lucky-promotion', all: ['come back', 'land the gold ball'], any: ['prizes', 'win'], hints: ['elite box', 'play free'] },
  { state: 'lucky-shot', all: ['lucky'], any: ['play free', 'gold ball'], hints: ['lucky shot'] },
  { state: 'table-selection', all: ['entry fee'], any: ['prize'], hints: ['players online', 'cushion shot', 'wins', 'berlin', 'mumbai'] },
  { state: 'lobby', all: ['play', 'special', '9 ball'], any: ['box', 'unlock'], hints: ['1 on 1', 'clubs', 'missions'] },
  { state: 'connecting', all: ['connecting'], any: [], hints: [] },
  { state: 'loading', all: ['loading'], any: [], hints: [] }
];

function normalise(text) {
  if (Array.isArray(text)) text = text.filter(Boolean).join('\n');
  const flat = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return ` ${flat} `;
}

// Boundary-aware matching. The padded string plus surrounding spaces reproduces the \b semantics
// of the original regexes for single words and works for phrases too, so "Reconnecting to the
// server" does not satisfy the "connecting" gate and "unloading" does not satisfy "loading".
function hasTerm(padded, term) {
  return padded.includes(` ${term} `);
}

function scoreRule(rule, text) {
  const evidence = [];
  for (const term of rule.all) {
    if (!hasTerm(text, term)) return null;
    evidence.push(term);
  }
  const matchedAny = rule.any.filter(term => hasTerm(text, term));
  if (rule.any.length && !matchedAny.length) return null;
  const matchedHints = rule.hints.filter(term => hasTerm(text, term));
  evidence.push(...matchedAny, ...matchedHints);
  const total = rule.all.length * 2 + rule.any.length + rule.hints.length;
  const matched = rule.all.length * 2 + matchedAny.length + matchedHints.length;
  return { score: Number((matched / total).toFixed(3)), evidence };
}

function visibleTables(text) {
  return TABLES.filter(table => hasTerm(text, table.toLowerCase()));
}

function classify(text) {
  const flat = normalise(text);
  const tables = visibleTables(flat);
  const scored = [];
  const seenStates = new Set();
  for (const rule of RULES) {
    const result = scoreRule(rule, flat);
    if (result && !seenStates.has(rule.state)) {
      scored.push({ state: rule.state, score: result.score, evidence: result.evidence });
      seenStates.add(rule.state);
    }
  }
  if (!scored.length) return { state: 'unrecognized', score: 0, evidence: [], alternatives: [], visibleTables: tables };
  const [winner, ...rest] = scored;
  return { state: winner.state, score: winner.score, evidence: winner.evidence, alternatives: rest.slice(0, 3), visibleTables: tables };
}

// Kept for callers that only need the label; `classify` is the rich form.
function classifyText(text) {
  return classify(text).state;
}

async function contrastImage(image) {
  const pixels = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = pixels.info;
  // Every byte is overwritten below. Avoid zero-filling a full frame, and advance one source
  // pointer instead of recomputing three pixel offsets for every output byte.
  const mask = Buffer.allocUnsafe(width * height);
  const data = pixels.data;
  for (let source = 0, target = 0; target < mask.length; source += channels, target++) {
    const r = data[source],
      g = data[source + 1],
      b = data[source + 2];
    const low = Math.min(r, g, b),
      high = Math.max(r, g, b);
    mask[target] = low > 165 && high - low < 70 ? 0 : 255;
  }
  return sharp(mask, { raw: { width, height, channels: 1 } })
    .png({ compressionLevel: 1 })
    .toBuffer();
}

/** @param {{tableMatcher?: {match: (image: Buffer|string) => Promise<string|null>}, workerFactory?: typeof createWorker}} [options] */
async function createScreenReader({ tableMatcher, workerFactory = createWorker } = {}) {
  const workerOptions = {
    langPath: language.langPath,
    gzip: true,
    cacheMethod: 'none',
    logger: () => {},
    errorHandler: () => {}
  };
  const provisioned = await Promise.allSettled([workerFactory('eng', 1, workerOptions), workerFactory('eng', 1, workerOptions)]);
  if (provisioned.some(result => result.status === 'rejected')) {
    await Promise.allSettled(provisioned.map(result => (result.status === 'fulfilled' ? result.value.terminate() : undefined)));
    const failed = provisioned.find(result => result.status === 'rejected');
    throw failed?.status === 'rejected' ? failed.reason : new Error('Screen reader worker startup failed.');
  }
  const [colorWorker, maskWorker] = provisioned.map(result => {
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  });
  const configured = await Promise.allSettled(
    [colorWorker, maskWorker].map(worker => worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '150' }))
  );
  if (configured.some(result => result.status === 'rejected')) {
    await Promise.allSettled([colorWorker.terminate(), maskWorker.terminate()]);
    const failed = configured.find(result => result.status === 'rejected');
    throw failed?.status === 'rejected' ? failed.reason : new Error('Screen reader worker configuration failed.');
  }
  let maskTail = Promise.resolve();
  let preferSinglePass = false;
  return {
    workerCount: 2,
    async inspect(image) {
      const started = performance.now();
      const stages = {
        firstOcrMs: 0,
        visualMatchMs: 0,
        contrastPrepMs: 0,
        contrastOcrMs: 0,
        bottomPrepMs: 0,
        bottomOcrMs: 0,
        readingsMs: 0
      };
      const measure = async (key, operation) => {
        const start = performance.now();
        try {
          return await operation();
        } finally {
          stages[key] += performance.now() - start;
        }
      };
      // The block tree is requested because the balances carry no words to match on: their identity comes
      // from where they sit, which only the positioned output can say.
      const colorPass = measure('firstOcrMs', () => colorWorker.recognize(image, {}, { text: true, blocks: true }));
      const deferMaskOcr = preferSinglePass;
      let skipMask = false;
      const firstPass = colorPass.then(async ({ data }) => {
        const first = classify(data.text);
        /** @type {string|null} */
        let visualTable = null;
        if (first.state === 'table-selection' && tableMatcher)
          visualTable = await measure('visualMatchMs', () => tableMatcher.match(image));
        const settledLuckyShot = first.state === 'lucky-shot' && hasTerm(normalise(data.text), 'enjoy today s free lucky shot');
        const settled = Boolean(visualTable || settledLuckyShot || first.state === 'lucky-promotion' || first.state === 'shop');
        skipMask = settled;
        return { data, visualTable, settled };
      });
      // Tesseract cannot cancel a running job without terminating its worker. Keep mask jobs
      // serialized across frames. After a settled screen, defer the next mask OCR until its
      // first pass decides whether it is needed; an unknown/complex screen still runs both now.
      const maskPass = maskTail.then(async () => {
        const contrastFrame = await measure('contrastPrepMs', () => contrastImage(image));
        if (deferMaskOcr) await firstPass;
        if (skipMask) return null;
        return measure('contrastOcrMs', () => maskWorker.recognize(contrastFrame));
      });
      maskTail = maskPass.then(
        () => {},
        () => {}
      );
      const firstDecision = await firstPass;
      const { data, settled } = firstDecision;
      let { visualTable } = firstDecision;
      preferSinglePass = settled;
      // The reviewed Lucky Shot entry screen has a distinct lower caption; the promotion dialog
      // has its own multi-phrase gate. Once either is established on the first pass, a second pass
      // only adds latency and can blend text from both layouts into a wrong state.
      // All reviewed shop layouts have distinctive multi-phrase first-pass gates. The contrast
      // pass changed neither their classification nor their visible account readings in the
      // Evidence replay, so it is unnecessary after one of those gates succeeds.
      // Table selection similarly skips the second pass only with a strong local visual venue match.
      // Other screens keep the complete OCR path, including uncertain table and lobby balances.
      /** @type {{data: {text: string}}|null} */
      let contrast = null;
      if (!settled) contrast = await maskPass;
      const recognizedText = data.text + '\n' + (contrast?.data.text || '');
      const observedAt = new Date().toISOString();
      let result = classify(recognizedText);
      let source = 'full-frame';
      if (result.state === 'unrecognized') {
        // The band ratio and its magnification come from the pipeline (ADR-0015), so the geometry the second
        // pass depends on has one definition instead of a literal repeated here.
        const bottom = await measure('bottomPrepMs', async () => {
          const size = await sharp(image).metadata();
          const { bottomBand } = handles({ width: size.width, height: size.height });
          return sharp(image).extract(bottomBand.rect).resize(bottomBand.resize).png().toBuffer();
        });
        const details = await measure('bottomOcrMs', () => colorWorker.recognize(bottom));
        const detailResult = classify(details.data.text);
        if (['loading', 'connecting'].includes(detailResult.state)) {
          result = detailResult;
          source = 'bottom-band';
        }
      }
      if (result.state === 'table-selection') {
        if (!visualTable && tableMatcher) visualTable = await measure('visualMatchMs', () => tableMatcher.match(image));
        if (visualTable) result.visibleTables = [...new Set([...result.visibleTables, visualTable])];
      }
      // Keep OCR text inside this local reader. Only numeric readings may leave it: the positioned balances,
      // then anything the labelled matcher found that they did not already answer for.
      const readingStarted = performance.now();
      const size = await sharp(image).metadata();
      const bounds = { width: size.width, height: size.height };
      const labelled = parseVisibleReadings(recognizedText, observedAt, Number(data.confidence) / 100);
      const readings = { ...labelled, ...readingsFromCells(cellsFromBlocks(data.blocks), bounds, observedAt) };
      stages.readingsMs = performance.now() - readingStarted;
      return {
        state: result.state,
        score: result.score,
        evidence: result.evidence.slice(0, 4),
        visibleTables: result.visibleTables,
        tableMatch: result.state === 'table-selection' && visualTable ? { table: visualTable, method: 'local-evidence' } : null,
        source,
        observedAt,
        readings,
        // Fixed numeric timings only. Raw OCR text and image data never leave this reader.
        stages: { ...stages, totalMs: performance.now() - started }
      };
    },
    close: async () => {
      await Promise.allSettled([colorWorker.terminate(), maskWorker.terminate()]);
    }
  };
}

module.exports = { classify, classifyText, contrastImage, createScreenReader, visibleTables, RULES };
