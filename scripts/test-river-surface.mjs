import assert from 'node:assert/strict';
import test from 'node:test';
import { ShapeUtils, Vector2 } from 'three';
import { buildRiverSurface } from '../src/river-surface.ts';

function area(mesh) {
  let total = 0;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const [a, b, c] = mesh.indices.slice(index, index + 3).map(vertex => mesh.points[vertex]);
    total += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  }
  return total;
}

test('river tessellation preserves a concave bank and island hole', () => {
  const outline = [[0, 0], [28, 0], [28, 23], [13, 23], [13, 15], [0, 15]];
  const hole = [[17, 6], [20, 6], [20, 10], [17, 10]];
  const triangulation = ShapeUtils.triangulateShape(outline.map(point => new Vector2(...point)),
    [hole.map(point => new Vector2(...point))]).flat();
  const mesh = buildRiverSurface([...outline, ...hole], triangulation, () => 15, 8, [0, 0]);
  assert.ok(Math.abs(area(mesh) - (28 * 23 - 13 * 8 - 3 * 4)) < 1e-6);
  assert.ok(mesh.heights.every(height => height === 15.12));
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const triangle = mesh.indices.slice(index, index + 3).map(vertex => mesh.points[vertex]);
    const mean = axis => triangle.reduce((sum, point) => sum + point[axis], 0) / 3;
    assert.ok(mean(0) <= 17 || mean(0) >= 20 || mean(1) <= 6 || mean(1) >= 10);
  }
});

test('river geometry follows both local terrain triangle planes even across an eight-metre fall', () => {
  const points = [[0, 0], [16, 0], [16, 8], [0, 8]];
  const indices = [0, 1, 2, 0, 2, 3];
  const source = (east, north) => 30 - east + (east === 8 && north === 8 ? 3 : 0);
  const mesh = buildRiverSurface(points, indices, source, 8, [0, 0]);
  assert.ok(mesh.heights.includes(30.12) && mesh.heights.includes(14.12));
  for (let index = 0; index < mesh.points.length; index++) {
    const [east, north] = mesh.points[index];
    const ridge = east <= 8 ? Math.min(east, north) : Math.min(16 - east, north);
    assert.ok(Math.abs(mesh.heights[index] - (source(east, 0) + ridge * 3 / 8 + .12)) < 1e-8);
  }
});

test('overlapping stream tiles can share complete non-overlapping river cells', () => {
  const points = [[0, 0], [16, 0], [16, 8], [0, 8]];
  const indices = [0, 1, 2, 0, 2, 3];
  const west = buildRiverSurface(points, indices, () => 0, 8, [0, 0], east => east < 8);
  const east = buildRiverSurface(points, indices, () => 0, 8, [0, 0], x => x >= 8);
  assert.equal(area(west) + area(east), 128);
  const boundary = mesh => mesh.points.filter(point => point[0] === 8).map(point => point[1]).sort((a, b) => a - b);
  assert.deepEqual(boundary(west), boundary(east));
});
