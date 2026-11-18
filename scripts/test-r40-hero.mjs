import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Group, Vector3 } from 'three';
import { Cameras } from '../src/cameras.ts';
import { frameHero, heroShots } from '../src/hero.ts';

const { services: [route] } = JSON.parse(readFileSync(new URL('../public/data/r40/network.json', import.meta.url), 'utf8'));

test('the hero gallery covers the mapped station and civil structures in all three views', () => {
  const shots = heroShots(route);
  assert.equal(shots.length, 8);
  assert.equal(new Set(shots.map(shot => shot.id)).size, 8);
  assert.deepEqual(new Set(shots.map(shot => shot.view)), new Set(['cab', 'chase', 'map']));
  assert.equal(shots[2].distance, route.stations[1].stopDistance);
  assert.ok(route.spans.some(span => span.bridge && span.start < shots[3].distance && span.end > shots[3].distance));
  assert.ok(route.spans.some(span => span.tunnel && Math.abs(span.end + 22 - shots[4].distance) < .001));
  assert.ok(shots.every(shot => shot.distance > 0 && shot.distance < route.length));
});

test('the chase reference camera clears the terrain and cuts without a transition', () => {
  const camera = new Cameras();
  const train = new Group();
  const [chase] = heroShots(route);
  frameHero(camera, chase, train.position);
  camera.update(train, new Vector3(), 0, () => 15);
  assert.equal(camera.view, 'chase');
  assert.ok(camera.settled);
  assert.ok(camera.camera.position.y >= 16.7);
});
