import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createCanvas } from '@napi-rs/canvas';
import { Vector3 } from 'three';
import { Rail } from '../src/rail.ts';
import { createVegetation, placeVegetation } from '../src/vegetation.ts';

const rectangle = (west, south, east, north) =>
  [[west, south], [east, south], [east, north], [west, north]];
const forest = new Set(['spruce', 'pine', 'birch']);
const data = {
  service: 'woodland-fixture',
  rail: [
    { distance: 0, east: 0, north: -100, height: 10 },
    { distance: 200, east: 0, north: 100, height: 10 },
  ],
  terrain: { width: 21, height: 21, east: -100, north: 100, spacing: 10, samples: Array(441).fill(10) },
  spans: [{ start: 0, end: 200, osmWay: 1, electrified: true, bridge: false, tunnel: false, speedLimit: null }],
  features: [
    { osmId: 2, type: 'forest', points: rectangle(-100, -100, 100, 100),
      holes: [rectangle(-80, -80, -40, -40)], tags: { leaf_type: 'broadleaved' } },
    { osmId: 3, type: 'platform', points: rectangle(4, 24, 15, 80), tags: {} },
    { osmId: 4, type: 'track', points: [[21, -100], [21, 100]], tags: {} },
  ],
  stations: [],
};

test('woodland and understory respect mapped no-growth areas and streamed tile ownership', () => {
  const rail = new Rail(data.rail);
  const options = { ownsCell: x => x > 0 };
  const plants = placeVegetation(data, rail, options);
  assert.ok(plants.length > 20);
  assert.deepEqual(placeVegetation(data, rail, options), plants);
  for (const plant of plants) {
    const { east, north, width, kind } = plant;
    assert.ok(east > 0);
    assert.ok(!(east >= 4 && east <= 15 && north >= 24 && north <= 80));
    if (forest.has(kind)) assert.equal(kind, 'birch');
    const minimum = forest.has(kind) ? 4.8 + width * 0.52 : 3.05 + width * 0.55;
    const setback = Math.min(east, Math.abs(east - 21));
    assert.ok(setback >= minimum);
    if (forest.has(kind) && setback < 14) assert.ok(plant.height < 3.2);
    if (forest.has(kind) && setback < 26) assert.ok(plant.height < 6);
  }
  assert.ok(placeVegetation(data, rail).every(plant =>
    !(plant.east >= -80 && plant.east <= -40 && plant.north >= -80 && plant.north <= -40)));
});

test('steep exposed slopes carry compact dry plants while mature woodland stays green', () => {
  const hillside = {
    ...data,
    features: data.features.filter(feature => feature.type !== 'forest'),
    terrain: { ...data.terrain, samples: data.terrain.samples.map((_, i) =>
      10 + Math.max(0, i % 21 - 10) * 3.4) },
  };
  const rail = new Rail(hillside.rail);
  const dry = placeVegetation(hillside, rail).filter(plant => plant.dry > 0);
  assert.ok(dry.length > 20);
  assert.ok(dry.every(plant => plant.east > 0 && plant.height < 0.68 &&
    ['grass', 'willow'].includes(plant.kind)));
  assert.deepEqual(placeVegetation({ ...hillside, features: data.features }, rail)
    .filter(plant => plant.dry > 0 && plant.east > 43), []);
});

test('the baked R40 woodland supports distinct species and varied shoulder plants', async () => {
  const world = JSON.parse(await readFile('public/data/service.json', 'utf8'));
  const plants = placeVegetation(world, new Rail(world.rail));
  const kinds = new Set(plants.map(plant => plant.kind));
  assert.deepEqual(kinds, new Set(['spruce', 'pine', 'birch', 'grass', 'fern', 'willow', 'fireweed']));
  assert.ok(plants.filter(plant => plant.height > 7).length > 500);
  assert.ok(plants.some(plant => plant.kind === 'fireweed' && plant.width < 1.5));
});

test('woodland detail is exclusive and wind updates matching shadow depth geometry', () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => createCanvas(1, 1) };
  try {
    const vegetation = createVegetation(data, new Rail(data.rail));
    try {
      const near = vegetation.group.getObjectByName('Woodland crown detail');
      const far = vegetation.group.getObjectByName('Mapped woodland canopy');
      const camera = near.boundingSphere.center.clone();
      vegetation.update(camera, 0.12, 'rain');
      assert.equal(near.visible, true);
      assert.equal(far.visible, false);
      vegetation.update(new Vector3(2000, 15, 2000), 0.08, 'snow');
      assert.equal(near.visible, false);
      assert.equal(far.visible, true);
      assert.equal(near.customDepthMaterial.map, near.material.map);
      assert.ok(near.geometry.getAttribute('plantAtlas').isInstancedBufferAttribute);
      const vertexShader = ['#include <common>', '#include <uv_vertex>', '#include <begin_vertex>'].join('\n');
      const color = { uniforms: {}, vertexShader,
        fragmentShader: '#include <common>\n#include <map_fragment>\n#include <color_fragment>' };
      const depth = { uniforms: {}, vertexShader, fragmentShader: '#include <common>\n#include <alphatest_fragment>' };
      near.material.onBeforeCompile(color);
      near.customDepthMaterial.onBeforeCompile(depth);
      assert.equal(color.vertexShader, depth.vertexShader);
      assert.match(color.vertexShader, /lookFrom.y \/ max\(0.01, length\(lookFrom\)\)/);
      assert.match(color.vertexShader, /smoothstep\(0.52, 0.77, viewElevation\)/);
      assert.match(color.fragmentShader, /goldMask \* max\(vBirchAutumn, 0.0\)/);
      assert.equal(near.geometry.getAttribute('plantAtlas').itemSize, 4);
      assert.equal(color.uniforms.plantTime, depth.uniforms.plantTime);
      assert.equal(color.uniforms.plantTime.value, 0.2);
      assert.equal(color.uniforms.plantPowder.value, 1);
    } finally {
      vegetation.dispose();
    }
  } finally {
    globalThis.document = previous;
  }
});
