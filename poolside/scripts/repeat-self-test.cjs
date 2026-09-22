'use strict';

// Run the desktop self-test several times and report a failure rate.
//
// A single green run cannot tell a passing suite from one that passes three times in four, and this suite
// spent a day doing exactly that: an inherited user-data directory made account checks fail, and a
// shop-return wait that was too close to its own timing failed under load. A flake is a defect in the
// gate itself, so the gate is measured rather than trusted.
//
// Usage: node scripts/repeat-self-test.cjs [--runs=5] [--target=<exe>]
//   default target: the source tree through the local Electron

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const runsArg = args.find(arg => arg.startsWith('--runs='));
const runs = Math.max(1, Number(runsArg ? runsArg.slice('--runs='.length) : 5) || 5);
const targetArg = args.find(arg => arg.startsWith('--target='));
const target = targetArg ? targetArg.slice('--target='.length) : null;

/** Path to the local Electron binary, without a shell. */
function electronBinary() {
  const candidates = [
    path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(root, 'node_modules', '.bin', 'electron.cmd')
  ];
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) throw new Error('The local Electron binary was not found; run npm ci first.');
  return found;
}

function runOnce() {
  return new Promise(resolve => {
    const command = target || electronBinary();
    const argv = target ? ['--self-test'] : [root, '--self-test'];
    const child = spawn(command, argv, { cwd: root, windowsHide: true });
    let output = '';
    child.stdout.on('data', chunk => (output += chunk));
    child.stderr.on('data', chunk => (output += chunk));
    child.on('error', error => resolve({ code: -1, output: `${output}\n${error.message}` }));
    child.on('close', code => resolve({ code: code === null ? -1 : code, output }));
  });
}

function firstFailureLine(output) {
  const match = output.match(/(?:AssertionError[^\n]*|Error: [^\n]*|not ok \d+[^\n]*)/);
  return match ? match[0].trim() : 'no failure line found';
}

/** The last lines of a failing run, because "it failed" is not a diagnosis. */
function failureTail(output) {
  const lines = output
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.trim().length);
  return lines.slice(-12);
}

(async () => {
  const results = [];
  for (let index = 1; index <= runs; index++) {
    const started = Date.now();
    const result = await runOnce();
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const passes = (result.output.match(/^PASS:/gm) || []).length;
    console.log(
      `run ${index}/${runs}: exit ${result.code}, ${passes} pass line(s), ${seconds}s${
        result.code === 0 ? '' : ` — ${firstFailureLine(result.output)}`
      }`
    );
    if (result.code !== 0) for (const line of failureTail(result.output)) console.log(`    | ${line}`);
    results.push(result);
  }
  const failures = results.filter(result => result.code !== 0).length;
  console.log(
    failures
      ? `${failures} of ${runs} self-test runs failed. That is a defect in the gate, not a rerun.`
      : `${runs} of ${runs} self-test runs passed.`
  );
  process.exitCode = failures ? 1 : 0;
})();
