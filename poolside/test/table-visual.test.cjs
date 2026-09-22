const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sharp = require('sharp');
const { feature, distance, nearestVenue, createTableVisualMatcher } = require('../src/table-visual.cjs');

function solid(color) {
  return sharp({ create: { width: 300, height: 200, channels: 3, background: color } })
    .png()
    .toBuffer();
}

test('a close visual venue match is accepted, while an ambiguous or distant image is refused', async () => {
  const red = await feature(await solid('#bd2010'));
  const blue = await feature(await solid('#1020bd'));
  const green = await feature(await solid('#20bd10'));
  const references = [
    { table: 'Bangkok', feature: red },
    { table: 'Dubai', feature: blue }
  ];
  assert.equal(distance(red, red), 0);
  assert.equal(nearestVenue(red, references), 'Bangkok');
  assert.equal(nearestVenue(blue, references), 'Dubai');
  assert.equal(nearestVenue(green, references), null);
  assert.equal(nearestVenue(red, [{ table: 'Bangkok', feature: red }]), null);
});

test('the matcher requires three verified local references per venue and rejects altered images', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolside-table-visual-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const samples = [];
  for (const [table, color] of [
    ['Bangkok', '#bd2010'],
    ['Dubai', '#1020bd']
  ]) {
    for (let index = 0; index < 3; index++) {
      const png = await solid(color);
      const file = path.join(root, `${table}-${index}.png`);
      fs.writeFileSync(file, png);
      samples.push({
        id: `${table}-${index}`,
        table,
        path: file,
        imageHash: createHash('sha256').update(png).digest('hex')
      });
    }
  }
  const matcher = createTableVisualMatcher({ references: () => samples });
  await matcher.warm();
  assert.equal(await matcher.match(await solid('#bd2010')), 'Bangkok');
  samples.splice(0, 1);
  assert.equal(await matcher.match(await solid('#bd2010')), null, 'two examples cannot authorize a venue');
  samples.push({ ...samples[0], id: 'corrupt', imageHash: '0'.repeat(64) });
  assert.equal(await matcher.match(await solid('#bd2010')), null, 'a wrong image hash cannot restore coverage');
});
