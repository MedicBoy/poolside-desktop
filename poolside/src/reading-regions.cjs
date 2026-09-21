// Which recognised numbers are account balances, and what each one is worth.
//
// The game draws its two balances in the top-right of the play surface with no words next to them: an
// icon and a number. There is nothing to match on, so identity comes from *where* the number sits and
// from its left-to-right order in that band. That is the whole reason this module exists — the label
// matching in `visible-readings.cjs` cannot see an unlabelled figure, and guessing one from the largest
// number on screen would be exactly the silent-wrong-value failure the roadmap forbids.
//
// The band is a fraction of the captured frame, not a pixel box, so it survives a window resize, a
// different zoom, and a different display scale factor. Its numbers were measured from live captures of
// the real game surface, not from a mock-up.
//
// Pure: no Electron, no fs. Enforced by test/architecture.test.cjs.

/**
 * The strip of the play surface that holds the balances, as fractions of the captured frame. The left
 * edge excludes the level badge and the leaderboard countdown, which sit in the same row but further
 * left; only the two currency figures fall inside it.
 */
const BALANCE_BAND = { top: 0.04, bottom: 0.16, left: 0.7 };

/**
 * Two words belong to the same figure when the gap between them is under this fraction of the frame
 * width. Measured from live captures: the gap inside one figure is about 0.005, and the gap between the
 * two figures — the currency icon — is about 0.06, so the split is not a close call.
 */
const GROUP_GAP = 0.025;

/** Left to right, the order the game draws them in. */
const SLOTS = [
  { key: 'cash', label: 'Cash' },
  { key: 'coins', label: 'Coins' }
];

const SUFFIXES = { k: 1e3, m: 1e6, b: 1e9 };
const NUMERIC = /^[\d\s.,]+[kmb]?$/i;

/**
 * Parse one figure as the game writes it: plain digits, digit groups separated by spaces or commas, or
 * an abbreviated form like `3.23k`. An abbreviated figure is reported as inexact rather than silently
 * treated as the real balance, because `3.23k` is not 3230 until something else confirms it.
 * @param {unknown} text
 * @returns {{value: number, exact: boolean}|null}
 */
function parseAmount(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/[\s,]/g, '');
  const match = /^(\d+(?:\.\d+)?)([kmb])?$/i.exec(cleaned);
  if (!match) return null;
  const digits = match[1];
  if (digits.replace('.', '').length > 15) return null;
  const numeric = Number(digits);
  if (!Number.isFinite(numeric)) return null;
  const suffix = match[2] ? match[2].toLowerCase() : null;
  const scaled = suffix ? numeric * SUFFIXES[suffix] : numeric;
  const value = Math.round(scaled);
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return { value, exact: !suffix };
}

/**
 * Whether a recognised word sits inside the balance band.
 * @param {{x: number, y: number, width: number, height: number}} box
 * @param {{width: number, height: number}} bounds
 */
function inBalanceBand(box, bounds) {
  if (!box || !bounds || !(bounds.width > 0) || !(bounds.height > 0)) return false;
  const middle = box.y + box.height / 2;
  return (
    middle >= bounds.height * BALANCE_BAND.top && middle <= bounds.height * BALANCE_BAND.bottom && box.x >= bounds.width * BALANCE_BAND.left
  );
}

/**
 * Group the numeric words in the band into one entry per figure, left to right.
 * @param {{text: string, box: {x: number, y: number, width: number, height: number}, confidence?: number|null}[]|null|undefined} cells
 * @param {{width: number, height: number}} bounds
 * @returns {{text: string, cells: any[]}[]}
 */
function balanceGroups(cells, bounds) {
  const candidates = (Array.isArray(cells) ? cells : [])
    .filter(cell => cell && cell.box && typeof cell.text === 'string' && NUMERIC.test(cell.text.trim()) && inBalanceBand(cell.box, bounds))
    .map(cell => ({ ...cell, text: cell.text.trim() }))
    .sort((a, b) => a.box.x - b.box.x);
  /** @type {{cells: any[], right: number}[]} */
  const groups = [];
  for (const cell of candidates) {
    const current = groups[groups.length - 1];
    const gap = current ? cell.box.x - current.right : Infinity;
    if (current && gap <= bounds.width * GROUP_GAP) {
      current.cells.push(cell);
      current.right = Math.max(current.right, cell.box.x + cell.box.width);
      continue;
    }
    groups.push({ cells: [cell], right: cell.box.x + cell.box.width });
  }
  return groups.map(group => ({ text: group.cells.map(cell => cell.text).join(''), cells: group.cells }));
}

/**
 * Flatten the recogniser's block tree into the flat cell list this module reads. Kept here rather than in
 * the recogniser so the shape of the tree is one module's problem.
 * @param {any[]|null|undefined} blocks
 */
function cellsFromBlocks(blocks) {
  /** @type {any[]} */
  const cells = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    for (const paragraph of (block && block.paragraphs) || []) {
      for (const line of (paragraph && paragraph.lines) || []) {
        for (const word of (line && line.words) || []) {
          const bbox = word && word.bbox;
          const text = word && typeof word.text === 'string' ? word.text.trim() : '';
          if (!text || !bbox) continue;
          cells.push({
            text,
            box: { x: bbox.x0, y: bbox.y0, width: bbox.x1 - bbox.x0, height: bbox.y1 - bbox.y0 },
            confidence: Number.isFinite(word.confidence) ? word.confidence : null
          });
        }
      }
    }
  }
  return cells;
}

/**
 * The balances a frame shows, keyed by currency. A figure is only as trustworthy as its least certain
 * word: a number split into three words is wrong if any one of them was misread, so the lowest confidence
 * is the reading's confidence rather than the average.
 * @param {any[]|null|undefined} cells
 * @param {{width: number, height: number}} bounds
 * @param {string} observedAt
 */
function readingsFromCells(cells, bounds, observedAt = new Date().toISOString()) {
  /** @type {Record<string, any>} */
  const readings = {};
  balanceGroups(cells, bounds)
    .slice(0, SLOTS.length)
    .forEach((group, index) => {
      const slot = SLOTS[index];
      const amount = parseAmount(group.text);
      if (!amount) return;
      const confidences = group.cells.map(cell => cell.confidence).filter(value => Number.isFinite(value));
      readings[slot.key] = {
        label: slot.label,
        value: amount.value,
        exact: amount.exact,
        confidence: confidences.length ? Number((Math.min(...confidences) / 100).toFixed(2)) : 0,
        observedAt,
        source: 'in-game header'
      };
    });
  return readings;
}

module.exports = { parseAmount, inBalanceBand, balanceGroups, cellsFromBlocks, readingsFromCells, SLOTS, BALANCE_BAND, GROUP_GAP };
