import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { createCanvas } from '@napi-rs/canvas';
import { Raycaster, Vector3 } from 'three';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import { Rail } from '../src/rail.ts';
import { createScenery } from '../src/scenery.ts';

test('the rendered Bulken bridge river clears the intersecting bank while staying below the deck', async () => {
  globalThis.document = { createElement: () => createCanvas(1, 1) };
  const bytes = await readFile(new URL('../public/data/r40/network/R40/R40-002.json.gz', import.meta.url));
  const data = JSON.parse(gunzipSync(bytes));
  const rail = new Rail(data.rail);
  const scene = createScenery(data, rail, { polished: true });
  const ground = scene.group.getObjectByName('Graded Copernicus DEM').children;
  const river = scene.group.children.filter(mesh => mesh.material?.transparent && mesh.material?.forceSinglePass);
  for (const mesh of [...ground, ...river]) {
    mesh.geometry.boundsTree = new MeshBVH(mesh.geometry, { indirect: true });
    mesh.raycast = acceleratedRaycast;
  }
  const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
  ray.firstHitOnly = true;
  const hit = (x, z, meshes) => {
    ray.ray.origin.set(x, 100, z);
    return ray.intersectObjects(meshes)[0]?.point.y;
  };
  // These are positions where the exact screenshot camera recorded the ground in front of the river.
  for (const [x, z] of [[1070.97, 246.03], [1072.50, 247.71], [1072.53, 248.58], [1073.29, 252.15],
    [1074.21, 253.19], [1074.35, 255.64], [1075.75, 257.10]]) {
    const surface = hit(x, z, river);
    const terrain = hit(x, z, ground);
    assert.ok(surface > terrain + 0.04, `Shore at ${x}, ${z}: ${surface} versus ${terrain}`);
  }
  const bridge = data.spans.find(span => span.bridge);
  let samples = 0;
  for (let distance = bridge.start; distance < bridge.end; distance += 0.5) {
    const { x, y, z } = rail.position(distance);
    const water = hit(x, z, river);
    if (water === undefined) continue;
    assert.ok(water < y - 1.05, `Water reaches the bridge deck at ${distance}`);
    samples++;
  }
  assert.ok(samples > 20);
  scene.dispose();
});
