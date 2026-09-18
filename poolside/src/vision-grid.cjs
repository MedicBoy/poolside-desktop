// Parsing recognised text into a positioned grid.
//
// The recogniser returns a text blob. Everything downstream then treats it as one string, which means a
// term is either present or not, with no way to say *where* it was seen or how sure the recogniser was.
// That is enough to classify a screen and not enough to debug one: "unknown" from a blob tells you nothing
// about whether the phrase was absent, misread, or read at low confidence from a blurry edge.
//
// So a recognition pass becomes a grid: cells with the text, the box it was seen in, the confidence the
// recogniser reported, and which row it belongs to. The grid is what the corpus drives and what a
// classification decision can cite. `gridText` is the bridge back to the existing rule engine — the
// classifier keeps reading text, and the grid is what decided which text, in what order.
//
// Pure: no Electron, no fs. Enforced by test/architecture.test.cjs.

const { clampRect } = require('./vision-frame.cjs');

/**
 * Tesseract reports word confidence 0–100. Below this a token is usually a misread rather than a real
 * word, so low-confidence tokens are counted and reported; they are never silently trusted.
 */
const LOW_CONFIDENCE = 60;

/** Vertical overlap ratio at which two cells are treated as the same row of a table. */
const ROW_OVERLAP = 0.5;

/** @param {unknown} value */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Collapse whitespace and trim; the recogniser emits both across a line and inside it. */
/** @param {unknown} value */
function cleanText(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();
}

/** @param {unknown} value @returns {number|null} */
function readConfidence(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/**
 * Recognised words, from the recogniser's own word list when it gave one, otherwise from the line's text.
 * @param {any} line @param {string} text
 */
function readWords(line, text) {
  const words = Array.isArray(line && line.words) ? line.words : null;
  if (words && words.length) {
    return words
      .map(word => ({ text: cleanText(isPlainObject(word) ? word.text : word), confidence: readConfidence(word && word.confidence) }))
      .filter(word => word.text.length > 0);
  }
  return text
    .split(' ')
    .filter(Boolean)
    .map(word => ({ text: word, confidence: null }));
}

/**
 * Build a grid from recognised lines.
 *
 * A line with no text is dropped as empty; a line whose box lies entirely outside the frame is dropped as
 * outside. Both are reported rather than ignored, because "the recogniser saw nothing there" and "there was
 * nothing there to see" are different findings and only one of them is about the recogniser.
 *
 * @param {any[]} lines each `{text, box: {x, y, width, height}, confidence?, words?}`
 * @param {{width: number, height: number}} bounds the captured frame
 * @returns {{cells: any[], rows: any[], dropped: {reason: string, text: string}[], telemetry: any}}
 */
function parseTextGrid(lines, bounds) {
  /** @type {any[]} */
  const cells = [];
  /** @type {{reason: string, text: string}[]} */
  const dropped = [];
  for (const raw of Array.isArray(lines) ? lines : []) {
    const line = isPlainObject(raw) ? raw : {};
    const text = cleanText(line.text);
    if (!text) {
      dropped.push({ reason: 'empty-text', text: '' });
      continue;
    }
    const clamped = clampRect(line.box, bounds);
    if (!clamped.ok) {
      dropped.push({ reason: clamped.reason, text });
      continue;
    }
    cells.push({
      text,
      box: clamped.rect,
      clipped: clamped.clipped,
      confidence: readConfidence(line.confidence),
      words: readWords(line, text)
    });
  }

  // Reading order: top to bottom, then left to right. Every later step depends on it, so it is established
  // once here rather than assumed by each consumer.
  cells.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);

  /** @type {any[]} */
  const rows = [];
  for (const cell of cells) {
    const current = rows[rows.length - 1];
    const overlap = current ? overlapRatio(current, cell.box) : 0;
    if (current && overlap >= ROW_OVERLAP) {
      current.cells.push(cell);
      current.bottom = Math.max(current.bottom, cell.box.y + cell.box.height);
      continue;
    }
    rows.push({ top: cell.box.y, bottom: cell.box.y + cell.box.height, cells: [cell] });
  }
  for (const row of rows) {
    row.cells.sort((a, b) => a.box.x - b.box.x);
    row.text = row.cells.map(cell => cell.text).join(' ');
  }

  const withConfidence = cells.filter(cell => cell.confidence !== null);
  const words = cells.flatMap(cell => cell.words);
  const lowConfidence = [
    ...cells
      .filter(cell => cell.confidence !== null && cell.confidence < LOW_CONFIDENCE)
      .map(cell => ({ text: cell.text, confidence: cell.confidence })),
    ...words.filter(word => word.confidence !== null && word.confidence < LOW_CONFIDENCE)
  ];
  return {
    cells,
    rows,
    dropped,
    telemetry: {
      cells: cells.length,
      rows: rows.length,
      words: words.length,
      meanConfidence: withConfidence.length
        ? Number((withConfidence.reduce((sum, cell) => sum + (cell.confidence || 0), 0) / withConfidence.length).toFixed(1))
        : null,
      lowConfidence,
      clipped: cells.filter(cell => cell.clipped).length,
      dropped: dropped.length
    }
  };
}

/**
 * The vertical overlap between a row's band and a cell, as a fraction of the shorter of the two. Used for
 * row grouping, where a strict equality of tops would split one visual row whenever the recogniser reports
 * slightly different heights for words on the same line.
 * @param {{top: number, bottom: number}} row
 * @param {{y: number, height: number}} box
 */
function overlapRatio(row, box) {
  const top = Math.max(row.top, box.y);
  const bottom = Math.min(row.bottom, box.y + box.height);
  const overlap = bottom - top;
  const shorter = Math.min(row.bottom - row.top, box.height);
  return shorter > 0 ? Math.max(0, overlap) / shorter : 0;
}

/**
 * The text the classifier reads: rows in reading order. This is the one place that decides what the rule
 * engine is given, so a change in grid handling cannot change recognition without changing this.
 * @param {{rows: {text: string}[]}} grid
 */
function gridText(grid) {
  return (grid && Array.isArray(grid.rows) ? grid.rows : []).map(row => row.text).join('\n');
}

/** One line for a log or an observation. */
/** @param {{telemetry: any, cells: any[]}} grid */
function describeGrid(grid) {
  const telemetry = (grid && grid.telemetry) || {};
  const parts = [`${telemetry.cells || 0} cell(s) in ${telemetry.rows || 0} row(s)`];
  if (telemetry.meanConfidence !== null && telemetry.meanConfidence !== undefined)
    parts.push(`mean confidence ${telemetry.meanConfidence}`);
  if (telemetry.lowConfidence && telemetry.lowConfidence.length) parts.push(`${telemetry.lowConfidence.length} low-confidence token(s)`);
  if (telemetry.clipped) parts.push(`${telemetry.clipped} clipped at the frame edge`);
  if (telemetry.dropped) parts.push(`${telemetry.dropped} dropped`);
  return parts.join(', ');
}

module.exports = { parseTextGrid, gridText, describeGrid, overlapRatio, cleanText, LOW_CONFIDENCE, ROW_OVERLAP };
