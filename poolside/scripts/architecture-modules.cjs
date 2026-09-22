// Keep the architecture document's module inventory true, mechanically.
//
// The inventory in `docs/architecture.md` had drifted badly: it listed the modules the project had when it was
// written and none of the ones added since — every match, run, capture-lab and identity module was missing, which
// made the document describe a smaller application than the one in the folder. A hand-maintained list of 150 files
// will drift again, so it is generated from the files themselves and checked in CI.
//
// The source of a module's one-line description is the first line of its leading comment. A module without one is
// reported rather than quietly listed as unknown: a file nobody can describe in a sentence is a file nobody can
// find later.
//
// Usage: `node scripts/architecture-modules.cjs --check` (default) or `--write`.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'architecture.md');
const BEGIN = '<!-- modules:begin -->';
const END = '<!-- modules:end -->';

/** Modules are listed in the order a reader meets them: entry points, then the areas, then the pure helpers. */
const order = name => {
  if (name === 'main.cjs') return 0;
  if (name === 'preload.cjs' || name === 'ipc.cjs') return 1;
  return 2;
};

/** The first line of a module's leading comment, or null when it has none. @param {string} source */
function summaryOf(source) {
  for (const line of source.split('\n').slice(0, 3)) {
    const text = line.trim();
    if (text.startsWith('//')) {
      const body = text.replace(/^\/\/\s?/, '').trim();
      // A decorative rule or a blank comment is not a description.
      if (body && !/^[-=]{3,}$/.test(body)) return body;
      continue;
    }
    if (text === '') continue;
    break;
  }
  return null;
}

/** Every source module with its summary, and the ones that have none. */
function inventory() {
  const files = fs
    .readdirSync(path.join(ROOT, 'src'))
    .filter(name => name.endsWith('.cjs'))
    .sort((left, right) => order(left) - order(right) || left.localeCompare(right));
  const described = [];
  const undescribed = [];
  for (const name of files) {
    const summary = summaryOf(fs.readFileSync(path.join(ROOT, 'src', name), 'utf8'));
    if (summary) described.push({ name, summary });
    else {
      undescribed.push(name);
      described.push({ name, summary: 'Not described yet.' });
    }
  }
  return { described, undescribed };
}

/** The generated section, marker to marker. */
function render() {
  const { described, undescribed } = inventory();
  const rows = described.map(entry => `| \`${entry.name}\` | ${entry.summary.replace(/\|/g, '\\|')} |`);
  return [
    BEGIN,
    '',
    `_Generated from the source by \`scripts/architecture-modules.cjs\`. ${described.length} modules, each with the`,
    'first line of its own header comment. `npm run docs:check` fails if a module is missing, or if it has no',
    'description to carry._',
    '',
    '| Module | What it is |',
    '| ------ | ---------- |',
    ...rows,
    '',
    undescribed.length
      ? `**Modules with no description yet (${undescribed.length}):** ${undescribed.map(name => `\`${name}\``).join(', ')}.`
      : '**Every module carries a description.**',
    '',
    END
  ].join('\n');
}

/** The project's own Prettier settings for a markdown file, so the written form is the checked form. */
function markdownOptions() {
  const rc = JSON.parse(fs.readFileSync(path.join(ROOT, '.prettierrc.json'), 'utf8'));
  const options = { ...rc, parser: 'markdown' };
  for (const override of rc.overrides || []) {
    if (typeof override.files === 'string' && override.files.endsWith('.md')) Object.assign(options, override.options);
  }
  delete options.overrides;
  return options;
}

/**
 * Replace the marked section in the document, then format it the way `format:check` will.
 *
 * The formatting is not decoration. A generated table is padded and normalised by Prettier (`*emphasis*` becomes
 * `_emphasis_`, cells are aligned), so an inventory written raw would fail the formatting gate the moment it was
 * produced — and an inventory that fails the gate is one somebody deletes instead of regenerating.
 * @param {string} document
 */
async function apply(document) {
  const start = document.indexOf(BEGIN);
  const end = document.indexOf(END);
  if (start < 0 || end < 0 || end < start)
    throw new Error(`docs/architecture.md is missing the ${BEGIN} … ${END} markers the inventory is written between.`);
  const inserted = `${document.slice(0, start)}${render()}${document.slice(end + END.length)}`;
  if (typeof document !== 'string' || !document.includes('#')) return inserted;
  try {
    return await require('prettier').format(inserted, markdownOptions());
  } catch (error) {
    // Formatting is a convenience here; the inventory itself is the point. A missing formatter must not make the
    // document uncheckable.
    if (/** @type {any} */ (error).code === 'MODULE_NOT_FOUND') return inserted;
    throw error;
  }
}

async function main() {
  const write = process.argv.includes('--write');
  const document = fs.readFileSync(DOC, 'utf8');
  const { undescribed } = inventory();
  const next = await apply(document);
  if (write) {
    fs.writeFileSync(DOC, `${next.replace(/\s*$/, '')}\n`, 'utf8');
    console.log(`architecture inventory written: ${inventory().described.length} modules.`);
    return;
  }
  const problems = [];
  if (next !== document) problems.push('the module inventory in docs/architecture.md is out of date');
  if (undescribed.length) problems.push(`${undescribed.length} module(s) have no description: ${undescribed.join(', ')}`);
  if (problems.length) {
    console.log(problems.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(`architecture inventory is current: ${inventory().described.length} modules, all described.`);
}

if (require.main === module) main();

module.exports = { inventory, render, apply, summaryOf, BEGIN, END };
