import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { Rail } from '../src/rail.ts';

const rail = new Rail([
  { distance: 0, east: 0, north: 0, height: 0 },
  { distance: 10, east: 10, north: 1, height: 1 },
  { distance: 20, east: 20, north: 3, height: 3 },
  { distance: 30, east: 29, north: 8, height: 2 },
  { distance: 40, east: 38, north: 13, height: 4 },
]);

test('rail grade lookup follows both directions through the cached intervals', () => {
  for (const [distance, expected] of [[20, 0.05], [35, 0.2], [5, 0.1], [25, -0.1], [10, 0.15]]) {
    assert.ok(Math.abs(rail.gradient(distance) - expected) < 1e-9);
  }
});

test('reusing a pose target preserves geometry and leaves independent poses intact', () => {
  const target = { position: new Vector3(), tangent: new Vector3(), cant: 0 };
  const first = rail.pose(9);
  const saved = first.position.clone();
  for (const distance of [23, 5, 33]) {
    assert.equal(rail.pose(distance, 3, target), target);
    assert.deepEqual(target, rail.pose(distance));
  }
  assert.ok(first.position.equals(saved));
});
