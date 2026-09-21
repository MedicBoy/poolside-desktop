const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FORMAT = 'poolside-release-evidence/v1';
const REQUIRED_REPORTS = [
  'tests',
  'lint',
  'typecheck',
  'sbom',
  'package',
  'packaged-self-test',
  'clean-vm',
  'update-rollback',
  'soak',
  'security-review',
  'compliance-review',
  'performance',
  'reproducibility'
];

function checkFile(root, entry, errors, label) {
  const relative = entry?.path;
  if (
    typeof relative !== 'string' ||
    !relative ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).includes('..') ||
    relative.includes('\\')
  ) {
    errors.push(`${label}: path must be a safe relative slash-separated path.`);
    return;
  }
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) {
    errors.push(`${label}: path escapes evidence root.`);
    return;
  }
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(target) !== target) throw new Error('not a regular file');
    const actual = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    if (!/^[a-f0-9]{64}$/.test(entry.sha256) || entry.sha256 !== actual) errors.push(`${label}: SHA-256 mismatch.`);
  } catch (error) {
    errors.push(`${label}: unreadable or unsafe file (${error instanceof Error ? error.message : String(error)}).`);
  }
}

function validate(manifest, root, release = false) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['Manifest must be an object.'];
  if (manifest.format !== FORMAT) errors.push('Unknown evidence format.');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) errors.push('Version must be semver core.');
  if (!/^[0-9a-f]{40}$/.test(manifest.commit)) errors.push('Commit must be a full SHA-1 Git commit ID.');
  if (!['development-preview', 'beta', 'stable'].includes(manifest.channel)) errors.push('Unknown channel.');
  if (!['draft', 'candidate', 'approved', 'rejected'].includes(manifest.status)) errors.push('Unknown release status.');
  for (const field of ['artifacts', 'reports', 'screenshots', 'matrix', 'signoffs']) {
    if (!Array.isArray(manifest[field])) errors.push(`${field} must be an array.`);
  }
  for (const [field, entries] of [
    ['artifacts', manifest.artifacts],
    ['reports', manifest.reports],
    ['screenshots', manifest.screenshots]
  ]) {
    if (!Array.isArray(entries)) continue;
    const paths = new Set();
    for (const [index, entry] of entries.entries()) {
      const label = `${field}[${index}]`;
      if (paths.has(entry?.path)) errors.push(`${label}: duplicate path.`);
      paths.add(entry?.path);
      checkFile(root, entry, errors, label);
      if (field === 'reports' && (typeof entry.kind !== 'string' || !entry.kind)) errors.push(`${label}: report kind required.`);
      if (field === 'screenshots' && (entry.privacyReviewed !== true || !entry.reviewer || !entry.reviewedAt))
        errors.push(`${label}: explicit secret/privacy review required.`);
      if (field === 'artifacts' && !['unsigned', 'verified'].includes(entry.signature))
        errors.push(`${label}: signature verdict required.`);
      if (field === 'artifacts' && entry.signature === 'verified') {
        if (!entry.signer) errors.push(`${label}: signer identity required.`);
        checkFile(root, entry.signatureReport, errors, `${label}.signatureReport`);
      }
    }
  }
  if (Array.isArray(manifest.matrix))
    for (const [index, result] of manifest.matrix.entries()) {
      if (!result?.configuration || !['pass', 'fail', 'not-run'].includes(result.status))
        errors.push(`matrix[${index}]: configuration and status required.`);
      if (result?.report) checkFile(root, result.report, errors, `matrix[${index}].report`);
    }
  if (Array.isArray(manifest.signoffs))
    for (const [index, signoff] of manifest.signoffs.entries()) {
      if (!signoff?.role || !signoff?.name || !signoff?.at || !['approve', 'reject'].includes(signoff.decision))
        errors.push(`signoffs[${index}]: named, dated decision required.`);
    }
  if (release || manifest.status === 'approved') {
    if (manifest.status !== 'approved') errors.push('Release qualification requires approved status.');
    if (!manifest.artifacts?.length || manifest.artifacts.some(item => item.signature !== 'verified'))
      errors.push('Every release artifact needs verified signing evidence.');
    const kinds = new Set((manifest.reports || []).map(item => item.kind));
    for (const kind of REQUIRED_REPORTS) if (!kinds.has(kind)) errors.push(`Missing ${kind} report.`);
    if (!manifest.screenshots?.length) errors.push('At least one privacy-reviewed release screenshot is required.');
    if (!manifest.matrix?.length || manifest.matrix.some(item => item.status !== 'pass' || !item.report))
      errors.push('Every release matrix row needs a passing report.');
    const approved = new Set((manifest.signoffs || []).filter(item => item.decision === 'approve').map(item => item.role));
    for (const role of ['product', 'qa', 'security', 'release']) if (!approved.has(role)) errors.push(`Missing ${role} approval.`);
  }
  return errors;
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/check-release-evidence.cjs <manifest.json> [--release]');
    process.exitCode = 2;
  } else {
    try {
      const absolute = path.resolve(file);
      const errors = validate(JSON.parse(fs.readFileSync(absolute, 'utf8')), path.dirname(absolute), process.argv.includes('--release'));
      if (errors.length) {
        errors.forEach(error => console.error(error));
        process.exitCode = 1;
      } else console.log('Release-evidence manifest and referenced hashes are valid. This is not by itself a release approval.');
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}

module.exports = { validate, checkFile, REQUIRED_REPORTS, FORMAT };
