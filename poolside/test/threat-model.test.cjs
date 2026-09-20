const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('the threat model covers local assets, trust boundaries, removal, verification, and residual work', () => {
  const document = read('docs/threat-model.md');
  for (const heading of [
    '## Assets worth protecting',
    '## Trust boundaries',
    '## Threats and current controls',
    '## Network behavior',
    '## Data handling and removal',
    '## Verification evidence',
    '## Remaining security work',
    '## Review triggers'
  ]) {
    assert.match(document, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(document, /ADR-0011/);
  assert.match(document, /does not display, export, or import passwords,\s*cookies, tokens/i);
  assert.match(document, /not yet code-signed/i);
});

test('the primary documentation points readers to the threat model', () => {
  assert.match(read('README.md'), /docs\/threat-model\.md/);
  assert.match(read('docs/architecture.md'), /\[the threat model\]\(threat-model\.md\)/);
});
