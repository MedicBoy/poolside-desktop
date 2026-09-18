const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Architectural guard rails, enforced as tests so `npm test` and CI cannot drift past them.
// These encode decisions from the roadmap: no module over 200 lines, no dependency cycles, and
// pure modules staying free of Electron so they remain unit testable.

const SRC = path.join(__dirname, '..', 'src');
const MAX_MODULE_LINES = 200;

// Modules that claim to be testable without an Electron runtime. They must not require electron.
const PURE_MODULES = ['layout.cjs', 'model.cjs', 'shop-recovery.cjs', 'game-region.cjs'];

const ENTRY_POINTS = ['main.cjs', 'self-test.cjs'];

function sourceFiles() {
  return fs
    .readdirSync(SRC)
    .filter(name => name.endsWith('.cjs'))
    .sort();
}

function read(name) {
  return fs.readFileSync(path.join(SRC, name), 'utf8');
}

function requireTargets(name) {
  const source = read(name);
  const targets = new Set();
  for (const match of source.matchAll(/require\(['"]\.\/([a-zA-Z0-9._-]+)['"]\)/g)) targets.add(match[1]);
  return targets;
}

test('no source module exceeds the modularity ceiling', () => {
  const oversized = sourceFiles()
    .map(name => ({ name, lines: read(name).split('\n').length }))
    .filter(entry => entry.lines > MAX_MODULE_LINES);
  assert.deepEqual(oversized, [], `modules over ${MAX_MODULE_LINES} lines must be split`);
});

test('the composition root stays a wiring layer', () => {
  const mainLines = read('main.cjs').split('\n').length;
  assert.ok(mainLines <= MAX_MODULE_LINES, `main.cjs is ${mainLines} lines`);
});

test('the local require graph is acyclic', () => {
  const graph = new Map(sourceFiles().map(name => [name, [...requireTargets(name)]]));
  const visiting = new Set();
  const done = new Set();
  const cycles = [];
  const walk = (name, trail) => {
    if (done.has(name)) return;
    if (visiting.has(name)) {
      cycles.push([...trail.slice(trail.indexOf(name)), name].join(' -> '));
      return;
    }
    visiting.add(name);
    for (const next of graph.get(name) || []) if (graph.has(next)) walk(next, [...trail, name]);
    visiting.delete(name);
    done.add(name);
  };
  for (const name of graph.keys()) walk(name, []);
  assert.deepEqual(cycles, [], `dependency cycles: ${cycles.join('; ')}`);
});

test('pure modules do not depend on Electron', () => {
  for (const name of PURE_MODULES) {
    assert.ok(sourceFiles().includes(name), `${name} should exist`);
    assert.ok(!/require\(['"]electron['"]\)/.test(read(name)), `${name} must stay Electron-free`);
  }
});

test('every module is reachable from a require or a documented reference', () => {
  const all = sourceFiles();
  const sources = all
    .map(name => ({ name, text: read(name) }))
    .concat(
      fs
        .readdirSync(path.join(__dirname, '..', 'test'))
        .filter(f => f.endsWith('.cjs'))
        .map(f => ({
          name: path.join('test', f),
          text: fs.readFileSync(path.join(__dirname, '..', 'test', f), 'utf8')
        }))
    );
  const orphans = all.filter(name => {
    if (ENTRY_POINTS.includes(name)) return false;
    return !sources.some(source => source.name !== name && source.text.includes(name));
  });
  assert.deepEqual(orphans, [], `modules not referenced anywhere: ${orphans.join(', ')}`);
});
