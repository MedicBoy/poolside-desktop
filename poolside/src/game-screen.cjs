const { createWorker, PSM } = require('tesseract.js');
const language = require('@tesseract.js-data/eng');
const sharp = require('sharp');

// Ordered rules. Order encodes precedence, not score: the first state that satisfies its gate
// wins. This matters because real screens overlap — the table selector renders the lobby's
// wording behind it, so table-selection must be evaluated before lobby.
//
// GATE (decides): every `all` term must appear, and if `any` terms are listed at least one must
// appear. These conditions are deliberately identical to the previous regex chain, so recognising
// the existing fixtures cannot silently change. `hints` never affect the gate.
// SCORE (reports): matched weight / total weight, i.e. confidence, not a decision.
// EVIDENCE (reports): the phrases that matched, so an unexpected result is debuggable.
//
// Defect history (D5): the previous classifier was a chain of AND-ed regexes returning a bare
// label — no score, no evidence, so a single missing phrase produced `unknown` with nothing to
// inspect. Loosening these gates is an M3 task that must be justified by the labelled corpus.
const RULES = [
  { state: 'lucky-promotion', all: ['come back every day'], any: ['play free'], hints: ['gold ball', 'free reward'] },
  { state: 'lucky-shot', all: ['lucky'], any: ['play free', 'gold ball'], hints: ['lucky shot'] },
  { state: 'table-selection', all: ['entry fee'], any: ['prize'], hints: ['players online', 'cushion shot', 'wins', 'berlin', 'mumbai'] },
  { state: 'lobby', all: ['play', 'special', '9 ball'], any: ['box', 'unlock'], hints: ['1 on 1', 'clubs', 'missions'] },
  { state: 'connecting', all: ['connecting'], any: [], hints: [] },
  { state: 'loading', all: ['loading'], any: [], hints: [] }
];

function normalise(text) {
  if (Array.isArray(text)) text = text.filter(Boolean).join('\n');
  const flat = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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

function classify(text) {
  const flat = normalise(text);
  const scored = [];
  for (const rule of RULES) {
    const result = scoreRule(rule, flat);
    if (result) scored.push({ state: rule.state, score: result.score, evidence: result.evidence });
  }
  if (!scored.length) return { state: 'unknown', score: 0, evidence: [], alternatives: [] };
  const [winner, ...rest] = scored;
  return { state: winner.state, score: winner.score, evidence: winner.evidence, alternatives: rest.slice(0, 3) };
}

// Kept for callers that only need the label; `classify` is the rich form.
function classifyText(text) {
  return classify(text).state;
}

async function createScreenReader() {
  const worker = await createWorker('eng', 1, {
    langPath: language.langPath, gzip: true, cacheMethod: 'none',
    logger: () => {}, errorHandler: () => {}
  });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '150' });
  return {
    async inspect(image) {
      const { data } = await worker.recognize(image);
      const pixels = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const { width, height, channels } = pixels.info;
      const mask = Buffer.alloc(width * height);
      for (let i = 0; i < mask.length; i++) {
        const r = pixels.data[i * channels], g = pixels.data[i * channels + 1], b = pixels.data[i * channels + 2];
        const low = Math.min(r, g, b), high = Math.max(r, g, b);
        mask[i] = low > 165 && high - low < 70 ? 0 : 255;
      }
      const filtered = await sharp(mask, { raw: { width, height, channels: 1 } }).png().toBuffer();
      const contrast = await worker.recognize(filtered);
      let result = classify(data.text + '\n' + contrast.data.text);
      let source = 'full-frame';
      if (result.state === 'unknown') {
        const bottom = await sharp(image).extract({ left: 0, top: Math.floor(height * .8), width, height: height - Math.floor(height * .8) }).resize({ width: width * 2 }).png().toBuffer();
        const details = await worker.recognize(bottom);
        const detailResult = classify(details.data.text);
        if (['loading', 'connecting'].includes(detailResult.state)) { result = detailResult; source = 'bottom-band'; }
      }
      // Return a state, a confidence score and the phrases that matched. Recognized account names
      // and balances are still discarded: only rule terms ever leave this function.
      return {
        state: result.state,
        score: result.score,
        evidence: result.evidence.slice(0, 4),
        source,
        observedAt: new Date().toISOString()
      };
    },
    close: () => worker.terminate()
  };
}

module.exports = { classify, classifyText, createScreenReader, RULES };
