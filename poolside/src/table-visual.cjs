// A conservative, local visual assist for the selected 1-on-1 venue card.
//
// Venue names are decorative logos, and several are not English text. OCR is still responsible for
// recognizing the table-selection screen; this matcher only adds the centered venue when a reviewed
// Evidence image is very close. It never learns from held-out Benchmark images or sends pixels away.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const sharp = require('sharp');
const { TABLES } = require('./table-list.cjs');

const FEATURE_WIDTH = 32;
const FEATURE_HEIGHT = 20;
const MAX_DISTANCE = 3000;
const MAX_COMPETITOR_RATIO = 0.8;
const MAX_REFERENCES_PER_TABLE = 32;
const MIN_REFERENCES_PER_TABLE = 3;

async function feature(image) {
  const size = await sharp(image).metadata();
  if (!size.width || !size.height || size.width < 100 || size.height < 100) return null;
  // The logo occupies the upper-left area of the centered venue card in the captured game surface.
  // Ratios keep the same region when the browser and display scale change.
  const rect = {
    left: Math.floor(size.width * 0.29),
    top: Math.floor(size.height * 0.2),
    width: Math.floor(size.width * 0.3),
    height: Math.floor(size.height * 0.24)
  };
  return sharp(image).extract(rect).resize(FEATURE_WIDTH, FEATURE_HEIGHT, { fit: 'fill' }).removeAlpha().raw().toBuffer();
}

function distance(left, right) {
  if (!left || !right || left.length !== right.length) return Infinity;
  let total = 0;
  for (let index = 0; index < left.length; index++) {
    const delta = left[index] - right[index];
    total += delta * delta;
  }
  return total / left.length;
}

function nearestVenue(candidate, references) {
  if (!candidate || !Array.isArray(references) || references.length < 2) return null;
  const nearest = new Map();
  for (const reference of references) {
    if (!TABLES.includes(reference.table)) continue;
    const measured = distance(candidate, reference.feature);
    if (measured < (nearest.get(reference.table) ?? Infinity)) nearest.set(reference.table, measured);
  }
  if (nearest.size < 2) return null;
  const ranked = [...nearest].sort((a, b) => a[1] - b[1]);
  const [table, best] = ranked[0];
  const competing = ranked[1][1];
  return best <= MAX_DISTANCE && best / competing <= MAX_COMPETITOR_RATIO ? table : null;
}

function createTableVisualMatcher({ references }) {
  const cache = new Map();
  /** @type {Promise<any[]>|null} */
  let refreshTask = null;

  async function loadReferences() {
    let available;
    try {
      available = references();
    } catch {
      return [];
    }
    if (!Array.isArray(available) || !available.length) {
      cache.clear();
      return [];
    }
    const countByTable = new Map();
    const current = new Set();
    const selected = [];
    for (const reference of available) {
      if (!TABLES.includes(reference.table) || typeof reference.id !== 'string' || typeof reference.path !== 'string') continue;
      const count = countByTable.get(reference.table) || 0;
      if (count >= MAX_REFERENCES_PER_TABLE) continue;
      countByTable.set(reference.table, count + 1);
      const key = `${reference.id}:${reference.imageHash}`;
      current.add(key);
      let cached = cache.get(key);
      try {
        const stat = fs.statSync(reference.path);
        if (!cached || cached.mtimeMs !== stat.mtimeMs || cached.size !== stat.size) {
          const png = fs.readFileSync(reference.path);
          if (createHash('sha256').update(png).digest('hex') !== reference.imageHash) {
            cache.delete(key);
            continue;
          }
          cached = { table: reference.table, feature: await feature(png), mtimeMs: stat.mtimeMs, size: stat.size };
          if (cached.feature) cache.set(key, cached);
        }
      } catch {
        cache.delete(key);
        continue;
      }
      if (cached.feature) selected.push(cached);
    }
    for (const key of cache.keys()) if (!current.has(key)) cache.delete(key);
    const counts = new Map();
    for (const reference of selected) counts.set(reference.table, (counts.get(reference.table) || 0) + 1);
    return selected.filter(reference => counts.get(reference.table) >= MIN_REFERENCES_PER_TABLE);
  }

  function refresh() {
    if (refreshTask) return refreshTask;
    refreshTask = loadReferences().finally(() => {
      refreshTask = null;
    });
    return refreshTask;
  }

  async function match(image) {
    const ready = await refresh();
    try {
      return nearestVenue(await feature(image), ready);
    } catch {
      return null;
    }
  }

  return { match, warm: refresh };
}

module.exports = { feature, distance, nearestVenue, createTableVisualMatcher };
