import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { Rail } from '../src/rail.ts';
import { auditTrackbed, auditVehicleClearance, createScenery } from '../src/scenery.ts';

// Use Canvas 2D to build the same surfaces without an additional WebGL process.
globalThis.document = {
  createElement(name) {
    assert.equal(name, 'canvas');
    return createCanvas(1, 1);
  },
};
const data = JSON.parse(await readFile('public/data/service.json', 'utf8'));
const rail = new Rail(data.rail);
const scenery = createScenery(data, rail);
const bed = auditTrackbed(scenery.group, rail, data);
const body = auditVehicleClearance(scenery.group, rail);
console.log(`Trackbed: ${bed.sampleCount} samples, ${bed.maxGap.toFixed(3)} m maximum gap, ${bed.missingCount} missing.`);
console.log(`Coach envelope: ${body.samples} samples, ${body.intersections} terrain, tunnel or building intersections.`);
assert.ok(bed.sampleCount > 0 && bed.missingCount === 0 && bed.maxGap <= 0.5);
assert.ok(body.samples > 0 && body.intersections === 0, JSON.stringify(body.first));
