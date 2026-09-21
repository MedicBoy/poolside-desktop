// Aggregate-only development check. This reads local Evidence images but prints no pixels, OCR text,
// file names, account names, or sample identifiers. It is not a held-out accuracy measurement.
const path = require('node:path');
const { createCaptureLab } = require('../src/capture-lab.cjs');
const { feature, nearestVenue } = require('../src/table-visual.cjs');

const root = process.argv[2] || (process.env.APPDATA && path.join(process.env.APPDATA, 'Poolside'));
if (!root) {
  console.error('Pass the Poolside user-data directory.');
  process.exitCode = 2;
} else {
  analyze(root).catch(() => {
    console.error('Could not analyze the local Evidence set.');
    process.exitCode = 2;
  });
}

async function analyze(dataRoot) {
  const lab = createCaptureLab({ root: dataRoot });
  const usable = new Set(lab.tableReferences().map(reference => reference.id));
  const samples = lab.list().filter(sample => sample.cohort === 'evidence' && sample.imageAvailable);
  const rows = [];
  for (const sample of samples) {
    try {
      const image = Buffer.from(lab.image(sample.id).png, 'base64');
      const visual = await feature(image);
      if (visual) rows.push({ sample, visual });
    } catch {
      // A missing or invalid local image cannot establish a visual reference or a result.
    }
  }
  const references = rows.filter(row => row.sample.expectedState === 'table-selection' && usable.has(row.sample.id));
  let accepted = 0;
  let correct = 0;
  let incorrect = 0;
  let unrelatedAccepted = 0;
  let originalMatches = 0;
  const byTable = new Map();
  for (const row of rows) {
    if (row.sample.expectedState === 'table-selection') {
      const table = row.sample.expectedTable;
      const item = byTable.get(table) || { images: 0, original: 0, visual: 0 };
      item.images++;
      if (row.sample.observedTables.includes(table)) {
        item.original++;
        originalMatches++;
      }
      const others = references.filter(reference => reference !== row);
      const counts = new Map();
      for (const reference of others) counts.set(reference.sample.expectedTable, (counts.get(reference.sample.expectedTable) || 0) + 1);
      const ready = others
        .filter(reference => counts.get(reference.sample.expectedTable) >= 3)
        .map(reference => ({ table: reference.sample.expectedTable, feature: reference.visual }));
      const predicted = nearestVenue(row.visual, ready);
      if (predicted) {
        accepted++;
        if (predicted === table) {
          correct++;
          item.visual++;
        } else incorrect++;
      }
      byTable.set(table, item);
    } else {
      const predicted = nearestVenue(
        row.visual,
        references.map(reference => ({ table: reference.sample.expectedTable, feature: reference.visual }))
      );
      if (predicted) unrelatedAccepted++;
    }
  }
  const tableImages = [...byTable.values()].reduce((sum, item) => sum + item.images, 0);
  console.log('Development-only table Evidence analysis (not a held-out benchmark)');
  console.log(`Saved table Evidence: ${tableImages}; original capture-time target detections: ${originalMatches}/${tableImages}.`);
  console.log(
    `Leave-one-out visual assist: ${correct}/${tableImages} correct, ${incorrect} wrong, ${tableImages - accepted} refused as uncertain.`
  );
  console.log(`Other-screen Evidence: ${rows.length - tableImages}; visual false accepts: ${unrelatedAccepted}.`);
  for (const [table, item] of [...byTable].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`${table}: ${item.images} Evidence images; original ${item.original}; visual leave-one-out ${item.visual}.`);
  }
}
