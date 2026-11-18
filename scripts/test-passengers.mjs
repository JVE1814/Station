import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { boardingApproach, createPassengers } from '../src/passengers.ts';
import { Rail } from '../src/rail.ts';

const platform = { outline: [[-4, 0], [0, 0], [0, 16], [-4, 16]], levelAt: () => 0.64, followsRail: true };

test('an open door alongside a mapped platform is reachable at its curb', () => {
  const approach = boardingApproach(platform, new Vector3(-2, 0.64, -8), new Vector3(0.4, 1.03, -9));
  assert.ok(approach);
  assert.equal(approach.y, 0.64);
  assert.ok(approach.x < 0 && approach.x > -0.2);
});

test('boarding rejects doors across a second track or on a different height', () => {
  const start = new Vector3(-2, 0.64, -8);
  assert.equal(boardingApproach(platform, start, new Vector3(4.8, 1.03, -9)), undefined);
  assert.equal(boardingApproach(platform, start, new Vector3(0.4, 5, -9)), undefined);
});


test('waiting figures board only after actual nearby door sills are provided', () => {
  const rail = new Rail([
    { distance: 0, east: 0, north: 0, height: 0 },
    { distance: 100, east: 0, north: 100, height: 0 },
  ]);
  const platform = { outline: [[-7, 3], [-1.85, 3], [-1.85, 85], [-7, 85]], levelAt: () => 0.64, followsRail: true };
  const actors = createPassengers([{ name: 'Test', osmId: 1412, position: [-3, 50], stopDistance: 50 }], [platform], rail);
  const figures = actors.group.children[0];
  assert.ok(figures.count > 0);
  const waiting = figures.count;
  const camera = new Vector3(-4, 5, -48);
  actors.update(25, camera);
  assert.equal(figures.count, waiting);
  actors.setDoors([-70, -53, -40, -23].map(north => new Vector3(-1.55, 1.03, north)));
  for (let step = 0; step < 260; step++) actors.update(0.1, camera);
  assert.ok(figures.count < waiting);
});
