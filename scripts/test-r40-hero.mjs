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

test('gallery camera poses stay exact when shots share the same scene', () => {
  const reused = new Cameras();
  const train = new Group();
  const eye = new Vector3(0.38, 2.7, -9.33);
  for (const shot of heroShots(route)) {
    train.position.set(shot.distance * .2, 27, -shot.distance * .5);
    const fresh = new Cameras();
    for (const camera of [fresh, reused]) {
      frameHero(camera, shot, train.position);
      camera.update(train, eye, 0, () => 28);
    }
    assert.ok(fresh.camera.position.distanceTo(reused.camera.position) < 1e-8, shot.id);
    assert.ok(fresh.camera.quaternion.angleTo(reused.camera.quaternion) < 1e-7, shot.id);
  }
});
