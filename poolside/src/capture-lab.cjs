// The Capture Lab: a private library of game screens, what the recogniser said about each, and the operator's verdict.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { evaluate, sampleMatches } = require('./capture-evaluation.cjs');
const { validateCaptureCorpus } = require('./capture-validation.cjs');
const { TABLES } = require('./table-list.cjs');
const {
  SAMPLE_STATES,
  COHORTS,
  validId,
  validState,
  validExpectedTable,
  validCohort,
  normaliseCohort,
  timing,
  normaliseSample
} = require('./capture-manifest.cjs');
const MANIFEST = 'manifest.json';
const IMAGE_DIRECTORY = 'images';

function createCaptureLab({ root }) {
  const directory = path.join(root, 'recognition-lab');
  const images = path.join(directory, IMAGE_DIRECTORY);
  const manifest = path.join(directory, MANIFEST);

  function prepare() {
    fs.mkdirSync(images, { recursive: true, mode: 0o700 });
  }

  function read() {
    if (!fs.existsSync(manifest)) return [];
    try {
      const stored = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (!Array.isArray(stored.samples)) return [];
      return stored.samples.map(normaliseSample).filter(Boolean);
    } catch {
      return [];
    }
  }

  function write(samples) {
    prepare();
    const temporary = `${manifest}.tmp`;
    const cleaned = samples.map(normaliseSample).filter(Boolean);
    fs.writeFileSync(temporary, JSON.stringify({ version: 2, samples: cleaned }, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, manifest);
  }

  function imagePath(id) {
    if (!validId(id)) throw new Error('Capture sample not found.');
    return path.join(images, `${id}.png`);
  }

  function list() {
    return read().map(
      ({
        id,
        expectedState,
        expectedTable,
        observedState,
        observedTables,
        score,
        source,
        capturedAt,
        width,
        height,
        cohort,
        reviewedAt,
        timing: storedTiming
      }) => ({
        id,
        expectedState,
        expectedTable,
        observedState,
        observedTables,
        matches: sampleMatches({ expectedState, expectedTable, observedState, observedTables }),
        score,
        source,
        capturedAt,
        width,
        height,
        cohort: normaliseCohort(cohort),
        reviewedAt: typeof reviewedAt === 'string' ? reviewedAt : null,
        timing: timing(storedTiming),
        imageAvailable: fs.existsSync(imagePath(id))
      })
    );
  }

  /**
   * @param {{png: Buffer, expectedState: unknown, expectedTable?: unknown, observed: {state?: unknown, score?: unknown, source?: unknown, visibleTables?: unknown}, frame: {width?: unknown, height?: unknown}, cohort?: unknown, timing?: unknown}} input
   */
  function record({ png, expectedState, expectedTable, observed, frame, cohort = 'evidence', timing: observedTiming }) {
    validState(expectedState);
    validExpectedTable(expectedState, expectedTable);
    validCohort(cohort);
    if (!Buffer.isBuffer(png) || !png.length) throw new Error('The game surface could not be captured.');
    const imageHash = createHash('sha256').update(png).digest('hex');
    if (read().some(sample => sample.imageHash === imageHash)) throw new Error('This exact screen has already been recorded.');
    prepare();
    const id = randomUUID();
    fs.writeFileSync(imagePath(id), png, { mode: 0o600 });
    const sample = {
      id,
      imageHash,
      cohort,
      expectedState,
      expectedTable: expectedState === 'table-selection' ? expectedTable : null,
      observedState: typeof observed?.state === 'string' ? observed.state : 'unrecognized',
      observedTables: Array.isArray(observed?.visibleTables) ? observed.visibleTables : [],
      score: Number.isFinite(observed?.score) ? Math.max(0, Math.min(1, Number(observed.score))) : 0,
      source: typeof observed?.source === 'string' ? observed.source : 'unavailable',
      capturedAt: new Date().toISOString(),
      width: Number.isInteger(frame?.width) ? frame.width : null,
      height: Number.isInteger(frame?.height) ? frame.height : null
    };
    const measured = timing(observedTiming);
    if (measured) sample.timing = measured;
    write([sample, ...read()]);
    return sample;
  }

  function image(id) {
    const file = imagePath(id);
    if (!fs.existsSync(file)) throw new Error('The capture image is no longer available.');
    return { id, png: fs.readFileSync(file).toString('base64') };
  }

  function remove(id) {
    const samples = read();
    if (!samples.some(sample => sample.id === id)) throw new Error('Capture sample not found.');
    const file = imagePath(id);
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    write(samples.filter(sample => sample.id !== id));
  }

  function markReviewed(id) {
    const samples = read();
    if (!samples.some(sample => sample.id === id)) throw new Error('Capture sample not found.');
    write(samples.map(sample => (sample.id === id ? { ...sample, reviewedAt: new Date().toISOString() } : sample)));
  }

  function setCohort(id, cohort) {
    validCohort(cohort);
    const samples = read();
    if (!samples.some(sample => sample.id === id)) throw new Error('Capture sample not found.');
    write(samples.map(sample => (sample.id === id ? { ...sample, cohort } : sample)));
  }

  function tableReferences() {
    return read()
      .filter(
        sample =>
          sample.cohort === 'evidence' &&
          sample.expectedState === 'table-selection' &&
          (sample.reviewedAt || sampleMatches(sample)) &&
          fs.existsSync(imagePath(sample.id))
      )
      .map(sample => ({ id: sample.id, table: sample.expectedTable, imageHash: sample.imageHash, path: imagePath(sample.id) }));
  }

  return {
    list,
    evaluation: () => {
      const samples = read();
      return { ...evaluate(samples, SAMPLE_STATES, TABLES), validation: validateCaptureCorpus(samples, SAMPLE_STATES) };
    },
    record,
    image,
    remove,
    markReviewed,
    setCohort,
    tableReferences,
    states: SAMPLE_STATES,
    tables: TABLES,
    cohorts: COHORTS
  };
}

module.exports = { createCaptureLab, SAMPLE_STATES, COHORTS };
