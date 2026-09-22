const fs = require('node:fs');
const path = require('node:path');
const { SAMPLE_STATES, normaliseSample } = require('../src/capture-manifest.cjs');
const { validateCaptureCorpus } = require('../src/capture-validation.cjs');

function defaultManifest() {
  return process.env.APPDATA ? path.join(process.env.APPDATA, 'Poolside', 'recognition-lab', 'manifest.json') : null;
}

function resolveManifest(input) {
  const target = path.resolve(input || defaultManifest() || 'manifest.json');
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) return target;
  const direct = path.join(target, 'manifest.json');
  const nested = path.join(target, 'recognition-lab', 'manifest.json');
  return fs.existsSync(direct) ? direct : nested;
}

function readSamples(manifest) {
  const value = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  if (!Array.isArray(value.samples)) throw new Error('Capture manifest does not contain a samples array.');
  return value.samples.map(normaliseSample).filter(Boolean);
}

function printSummary(report) {
  console.log(`Capture corpus: ${report.ready ? 'PASS' : 'NOT READY'}`);
  console.log(`Checks: ${report.passedGates}/${report.totalGates}`);
  for (const item of report.gates) console.log(`${item.pass ? 'PASS' : 'FAIL'}  ${item.label}: ${item.detail}`);
}

function main(argv) {
  if (argv.includes('--help')) {
    console.log('Usage: npm run validate:corpus -- [manifest-or-recognition-lab-directory] [--json]');
    return 0;
  }
  const input = argv.find(argument => !argument.startsWith('--'));
  const manifest = resolveManifest(input);
  if (!fs.existsSync(manifest)) throw new Error(`Capture manifest not found: ${manifest}`);
  const report = validateCaptureCorpus(readSamples(manifest), SAMPLE_STATES);
  if (argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else printSummary(report);
  return report.ready ? 0 : 1;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
