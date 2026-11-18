import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { Mesh } from 'three';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
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
const flags = process.argv.slice(2);
const r40Root = 'public/data/r40';
const sources = flags.includes('--r40')
  ? JSON.parse(await readFile(`${r40Root}/network.json`, 'utf8')).services.find(line => line.ref === 'R40').tiles
    .map(tile => tile.url.startsWith('data/') ? `public/${tile.url}` : `${r40Root}/${tile.url}`)
  : [flags.find(flag => !flag.startsWith('--')) ?? 'public/data/service.json'];
assert.ok(sources.length, 'A rendered corridor must have at least one tile');

for (const source of sources) {
  if (sources.length > 1) console.log(source);
  const bytes = await readFile(source);
  const data = JSON.parse(source.endsWith('.gz') ? gunzipSync(bytes) : bytes);
  const rail = new Rail(data.rail);
  const scenery = createScenery(data, rail, { polished: data.service === 'R40' });
  scenery.group.traverse(object => {
    if (!(object instanceof Mesh) || object.isInstancedMesh || !object.geometry.index) return;
    object.geometry.boundsTree ??= new MeshBVH(object.geometry, { indirect: true });
    object.raycast = acceleratedRaycast;
  });
  const bed = auditTrackbed(scenery.group, rail, data);
  const body = auditVehicleClearance(scenery.group, rail);
  scenery.dispose();
  if (flags.includes('--json')) console.log(JSON.stringify({ bed, body }));
  else {
    console.log(`Trackbed: ${bed.sampleCount} samples, ${bed.maxGap.toFixed(3)} m maximum gap, ${bed.missingCount} missing.`);
    console.log(`Coach envelope: ${body.samples} samples, ${body.intersections} intersections with terrain, tunnels, buildings, signals, bridges, platforms or catenary supports.`);
  }
  assert.ok(bed.sampleCount > 0 && bed.missingCount === 0 && bed.maxGap <= 0.5, JSON.stringify(bed.worstLocation));
  assert.ok(body.samples > 0 && body.intersections === 0, JSON.stringify(body.first));
}
