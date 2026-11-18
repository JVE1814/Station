import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const views = ['cab', 'chase', 'map'];
const conditions = ['day', 'night', 'snow'];
const shots = [...views.flatMap(view => conditions.map(condition => `${view}-${condition}`)), 'bridge', 'tunnel', 'station'];
const missing = [];
for (const shot of shots) {
  try {
    const png = await readFile(`evidence/${shot}.png`);
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', shot);
    assert.equal(png.readUInt32BE(16), 1920, `${shot} width`);
    assert.equal(png.readUInt32BE(20), 1080, `${shot} height`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    missing.push(shot);
  }
}
assert.deepEqual(missing, [], `Missing final browser captures: ${missing.join(', ')}`);
console.log(`${shots.length} browser captures at 1920 × 1080.`);
