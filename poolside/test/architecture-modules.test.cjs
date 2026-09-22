// The architecture document's module inventory, checked rather than trusted.
//
// The inventory had drifted by roughly twenty-five modules before this check existed: every match, run, capture-lab
// and identity module the project gained was missing from the document that is supposed to describe it. A list that
// is maintained by hand drifts again, so it is generated from `src/*.cjs` and this test fails when the document and
// the folder disagree — or when a module has no description for the table to carry.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modules = require('../scripts/architecture-modules.cjs');

const document = () => fs.readFileSync(path.join(__dirname, '..', 'docs', 'architecture.md'), 'utf8');

test('every source module is in the architecture inventory, and every module has a description', () => {
  const { described, undescribed } = modules.inventory();
  assert.equal(described.length, fs.readdirSync(path.join(__dirname, '..', 'src')).filter(name => name.endsWith('.cjs')).length);
  assert.deepEqual(undescribed, [], 'a module with no header line has nothing for the inventory to say');
  assert.ok(described.length > 100, 'the inventory covers the application, not a corner of it');
});

test('the document matches the source exactly, which is what makes the inventory worth reading', async () => {
  const current = document();
  assert.equal(await modules.apply(current), current, 'run `npm run docs:modules` after adding or renaming a module');
  assert.ok(current.includes(modules.BEGIN) && current.includes(modules.END));
  // Spot checks against the drift that caused this: the match and run machinery, and the modules added overnight.
  for (const name of ['match-coordination.cjs', 'run-coordination.cjs', 'run-report.cjs', 'pairing-evidence.cjs', 'attention.cjs'])
    // The table is padded by Prettier, so only the cell itself is asserted, not the spacing around it.
    assert.match(current, new RegExp('\\|\\s+`' + name.replace('.', '\\.') + '`\\s+\\|'), `${name} must be listed`);
});

test('a module without a description is reported rather than listed as unknown', () => {
  assert.equal(modules.summaryOf('const x = 1;\n'), null);
  assert.equal(modules.summaryOf('// A module.\nconst x = 1;\n'), 'A module.');
  assert.equal(modules.summaryOf('// ---\n// Real summary.\n'), 'Real summary.', 'a decorative rule is not a description');
  assert.equal(modules.summaryOf('\n// After a blank line.\n'), 'After a blank line.');
  assert.equal(modules.summaryOf('/* block comment */\n'), null, 'only the leading line comments are read');
});
