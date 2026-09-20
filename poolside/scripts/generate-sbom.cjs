// Generate a deterministic CycloneDX inventory from npm lockfile v3.  It is an inventory, not a
// vulnerability scan: review of the listed versions remains a release responsibility.

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function packageName(lockPath) {
  return lockPath.split('node_modules/').at(-1);
}

function packageUrl(name, version) {
  return `pkg:npm/${name.startsWith('@') ? name.replace('/', '%2F') : name}@${version}`;
}

function integrityHash(integrity) {
  if (typeof integrity !== 'string') return [];
  const [algorithm, content] = integrity.split('-', 2);
  return algorithm === 'sha512' && content ? [{ alg: 'SHA-512', content }] : [];
}

function component(lockPath, entry) {
  const name = packageName(lockPath);
  return {
    type: 'library',
    'bom-ref': `npm:${name}@${entry.version}#${lockPath}`,
    name,
    version: entry.version,
    purl: packageUrl(name, entry.version),
    scope: entry.optional ? 'optional' : 'required',
    licenses: entry.license ? [{ license: { id: entry.license } }] : [],
    hashes: integrityHash(entry.integrity),
    properties: [{ name: 'poolside:lockfile-path', value: lockPath }]
  };
}

function components(lock) {
  return Object.entries(lock?.packages || {})
    .filter(([lockPath, entry]) => lockPath && entry && typeof entry.version === 'string' && entry.dev !== true)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([lockPath, entry]) => component(lockPath, entry));
}

function bom(lock, lockText) {
  const root = lock?.packages?.[''] || {};
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${createHash('sha256').update(lockText).digest('hex').slice(0, 32)}`,
    version: 1,
    metadata: {
      component: {
        type: 'application',
        name: root.name || 'poolside',
        version: root.version || '0.0.0',
        purl: packageUrl(root.name || 'poolside', root.version || '0.0.0')
      },
      properties: [{ name: 'poolside:source-lockfile-sha256', value: createHash('sha256').update(lockText).digest('hex') }]
    },
    components: components(lock)
  };
}

function render(lockText) {
  return `${JSON.stringify(bom(JSON.parse(lockText), lockText), null, 2)}\n`;
}

function main(argv = process.argv.slice(2)) {
  const root = path.resolve(__dirname, '..');
  const lockPath = path.join(root, 'package-lock.json');
  const outputPath = path.join(root, 'docs', 'SBOM.cdx.json');
  const result = render(fs.readFileSync(lockPath, 'utf8'));
  if (argv.includes('--check')) {
    if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== result) {
      throw new Error('SBOM is out of date. Run npm run sbom.');
    }
    return;
  }
  fs.writeFileSync(outputPath, result, { mode: 0o600 });
}

if (require.main === module) main();

module.exports = { packageName, packageUrl, integrityHash, component, components, bom, render, main };
