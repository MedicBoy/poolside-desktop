const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const roadmap = fs.readFileSync(path.join(root, 'MASTER_ROADMAP.md'), 'utf8');
const items = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'work-items.json'), 'utf8'));

function validate(records = items) {
  const promised = [...roadmap.matchAll(/^- \*\*([A-Q]\d+)\*\*\s+(.+)$/gm)];
  const ids = promised.map(match => match[1]);
  const errors = [];
  if (new Set(ids).size !== ids.length) errors.push('Duplicate roadmap IDs.');
  if (!Array.isArray(records) || records.length !== ids.length)
    errors.push('The register must cover every roadmap deliverable exactly once.');
  const actual = new Map();
  for (const item of Array.isArray(records) ? records : []) {
    if (actual.has(item.id)) errors.push(`Duplicate register ID ${item.id}.`);
    actual.set(item.id, item);
  }
  for (const match of promised) {
    const item = actual.get(match[1]);
    if (!item) {
      errors.push(`Missing ${match[1]}.`);
      continue;
    }
    if (item.acceptance !== match[2].trim()) errors.push(`${item.id}: acceptance drifted from the roadmap.`);
    if (!['open', 'in-progress', 'blocked', 'complete'].includes(item.status)) errors.push(`${item.id}: invalid status.`);
    if (!item.owner || !item.requiredEvidence) errors.push(`${item.id}: owner/evidence contract missing.`);
    if (!Array.isArray(item.dependsOn) || item.dependsOn.some(id => !ids.includes(id) || id === item.id))
      errors.push(`${item.id}: invalid dependencies.`);
    if (item.status === 'complete' && item.dependsOn?.some(id => actual.get(id)?.status !== 'complete'))
      errors.push(`${item.id}: complete item depends on unfinished work.`);
    if (!Array.isArray(item.evidence) || (item.status === 'complete' && item.evidence.length === 0))
      errors.push(`${item.id}: complete requires evidence.`);
    for (const evidence of item.evidence || []) {
      if ((!/^[\w./-]+$/.test(evidence) || evidence.includes('..')) && evidence !== '../INCOMPLETE_WORK.md')
        errors.push(`${item.id}: evidence path is unsafe: ${evidence}`);
      else if (!fs.existsSync(path.join(root, evidence))) errors.push(`${item.id}: evidence path is missing or unsafe: ${evidence}`);
    }
  }
  for (const id of actual.keys()) if (!ids.includes(id)) errors.push(`Unknown register ID ${id}.`);
  const visiting = new Set();
  const visited = new Set();
  function walk(id) {
    if (visiting.has(id)) {
      errors.push(`Dependency cycle at ${id}.`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of actual.get(id)?.dependsOn || []) walk(dep);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of ids) walk(id);
  return errors;
}

if (require.main === module) {
  const errors = validate();
  if (errors.length) {
    errors.forEach(error => console.error(error));
    process.exitCode = 1;
  } else console.log(`${items.length} roadmap work items have owners, dependencies, acceptance, and evidence contracts.`);
}
module.exports = { validate };
