const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { components, render } = require('../scripts/generate-sbom.cjs');

const root = path.join(__dirname, '..');

test('SBOM keeps production and optional packages, omits development-only packages, and is deterministic', () => {
  const lock = {
    packages: {
      '': { name: 'fixture', version: '1.2.3' },
      'node_modules/runtime': { version: '2.0.0', license: 'MIT', integrity: 'sha512-abc' },
      'node_modules/optional': { version: '3.0.0', optional: true },
      'node_modules/dev-only': { version: '4.0.0', dev: true }
    }
  };
  const entries = components(lock);
  assert.deepEqual(
    entries.map(entry => entry.name),
    ['optional', 'runtime']
  );
  assert.equal(entries[0].scope, 'optional');
  assert.deepEqual(entries[1].hashes, [{ alg: 'SHA-512', content: 'abc' }]);
  assert.equal(render(JSON.stringify(lock)), render(JSON.stringify(lock)));
});

test('checked-in SBOM is exactly reproducible from the locked dependency tree', () => {
  const lock = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
  const sbom = fs.readFileSync(path.join(root, 'docs', 'SBOM.cdx.json'), 'utf8');
  assert.equal(sbom, render(lock));
  const parsed = JSON.parse(sbom);
  assert.equal(parsed.bomFormat, 'CycloneDX');
  assert.equal(parsed.specVersion, '1.5');
  assert.ok(parsed.components.length > 0);
});
