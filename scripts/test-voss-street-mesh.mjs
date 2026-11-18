import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, Raycaster, Vector3 } from 'three';
import { createVossStreets, sampleVossStreetTerrain } from '../src/voss-streets.ts';

const metadata = {
  version: 1, projection: 'test', osmSnapshot: 'test', stationOsmId: 1, center: [0, 0], radiusMetres: 500,
};
const street = (kind, points, widthMetres, tags = {}) => ({
  osmId: 1, part: 0, kind, points, widthMetres, tags: { highway: 'residential', ...tags },
});
const heightAt = (x, z) => x * 0.07 + z * 0.03 + 10;
const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
function hit(group, x, z) {
  ray.ray.origin.set(x, 100, z);
  return ray.intersectObject(group, true)[0];
}

test('street batches retain the mapped plan, rise with terrain and taper at the verge', () => {
  const group = createVossStreets({
    ...metadata,
    streets: [
      street('road', [[-10, 2], [0, 2], [10, 2]], 6, { surface: 'asphalt' }),
      street('access', [[-10, 12], [10, 12]], 4, { surface: 'gravel' }),
      street('path', [[-10, 22], [10, 22]], 2),
      street('road', [[-10, 32], [10, 32]], 4, { tunnel: 'yes' }),
    ],
  }, { heightAt });
  assert.deepEqual(group.children.map(child => child.name), ['OSM Voss road', 'OSM Voss access', 'OSM Voss path']);
  assert.ok(Math.abs(hit(group, 0, -2).point.y - (heightAt(0, -2) + 0.075)) < 0.00001);
  assert.ok(Math.abs(hit(group, 9, -2).point.y - (heightAt(9, -2) + 0.075)) < 0.00001);
  assert.ok(hit(group, 5, -5.15).point.y < heightAt(5, -5.15) + 0.075);
  assert.equal(hit(group, 5, -5.45), undefined);
  assert.equal(hit(group, 5, -32), undefined);
});

test('street triangles do not cross railway clearances or even narrow platform shapes', () => {
  const group = createVossStreets({
    ...metadata, streets: [street('road', [[-12, 0], [12, 0]], 5)],
  }, {
    heightAt, railPaths: [[[0, -8], [0, 8]]],
    platformOutlines: [[[6.71, 0.61], [6.86, 0.61], [6.86, 0.73], [6.71, 0.73]]],
    excluded: (x, z) => x < -8 && Math.abs(z) < 4,
  });
  for (let x = -2.59; x < 2.6; x += 0.1) {
    for (let z = -2.45; z < 2.5; z += 0.15) assert.equal(hit(group, x, z), undefined);
  }
  assert.equal(hit(group, 6.77, -0.69), undefined);
  assert.equal(hit(group, -10, 0), undefined);
  assert.ok(hit(group, -5, 0));
  assert.ok(hit(group, 10, 0));
});

test('the published Voss street sidecar renders in three local batches', async () => {
  const data = JSON.parse(await readFile(new URL('../public/data/r40/voss-streets.json', import.meta.url), 'utf8'));
  const group = createVossStreets(data, { heightAt: () => 56 });
  assert.equal(group.children.length, 3);
  let triangles = 0;
  for (const { geometry } of group.children) {
    const p = geometry.attributes.position;
    triangles += geometry.index.count / 3;
    for (let vertex = 0; vertex < p.count; vertex++) {
      assert.ok(Math.hypot(p.getX(vertex) - data.center[0], p.getZ(vertex) + data.center[1]) < data.radiusMetres + 15);
      assert.ok(Number.isFinite(p.getY(vertex)));
    }
  }
  assert.ok(triangles > 1000 && triangles < 95000, `Rendered ${triangles} triangles`);
});

test('street height can follow the rendered terrain diagonals exactly', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 8, 8, 0, 0, 8, 8, 8], 3));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  geometry.computeBoundingBox();
  const group = new Group().add(new Mesh(geometry));
  const sample = sampleVossStreetTerrain(group, metadata, () => -50);
  assert.equal(sample(2, 2), 0);
  assert.equal(sample(6, 6), 4);
  assert.equal(sample(8, 8), 8);
  assert.equal(sample(9, 8), -50);
});
