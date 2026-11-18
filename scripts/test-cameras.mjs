import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Vector3 } from 'three';
import { Cameras } from '../src/cameras.ts';

test('every settled camera follows interpolated train motion frame to frame', () => {
  const camera = new Cameras();
  const train = new Group();
  const eye = new Vector3(0.38, 2.70, -9.33);
  for (const mode of ['cab', 'chase', 'map']) {
    camera.select(mode);
    for (let frame = 0; frame < 60; frame++) camera.update(train, eye, 1 / 60);
    assert.ok(camera.settled);
    let previous = camera.camera.position.clone();
    let orientation = camera.camera.quaternion.clone();
    for (let frame = 0; frame < 120; frame++) {
      train.position.x += 19 / 60;
      camera.update(train, eye, 1 / 60);
      assert.ok(Math.abs(camera.camera.position.distanceTo(previous) - 19 / 60) < 1e-8);
      assert.ok(camera.camera.quaternion.angleTo(orientation) < 1e-6);
      previous = camera.camera.position.clone();
      orientation = camera.camera.quaternion.clone();
    }
  }
});

test('switching into the map animates from the current camera pose', () => {
  const camera = new Cameras();
  const train = new Group();
  const eye = new Vector3(0.38, 2.70, -9.33);
  camera.update(train, eye, 1 / 60);
  const beginning = camera.camera.position.clone();
  camera.select('map');
  camera.update(train, eye, 1 / 60);
  assert.ok(camera.camera.position.distanceTo(beginning) < 2);
  const firstFrame = camera.camera.position.clone();
  for (let frame = 0; frame < 60; frame++) camera.update(train, eye, 1 / 60);
  assert.ok(camera.camera.position.distanceTo(firstFrame) > 500);
  assert.ok(camera.settled);
});

test('chase orbit stays inside the bore when the tunnel constrains it', () => {
  const cameras = new Cameras();
  const train = new Group();
  const eye = new Vector3(0.38, 2.70, -9.33);
  const tunnel = { position: new Vector3(0, 0, -19), tangent: new Vector3(0, 0, -1), weight: 1 };
  cameras.select('chase');
  for (let frame = 0; frame < 60; frame++) cameras.update(train, eye, 1 / 60, undefined, tunnel);
  cameras.drag(200, -120);
  cameras.update(train, eye, 1 / 60, undefined, tunnel);
  const position = cameras.camera.position;
  assert.ok(Math.abs(position.x) <= 1.85);
  assert.ok(position.y >= 2.3 && position.y < 3.1);
  assert.equal(position.z, -19);
});

test('the map holds a selected station while the cab moves', () => {
  const cameras = new Cameras();
  const train = new Group();
  const eye = new Vector3(0.38, 2.70, -9.33);
  cameras.fitMap(new Vector3(170, 0, 65), train.position, 95);
  for (let frame = 0; frame < 60; frame++) cameras.update(train, eye, 1 / 60);
  const stationView = cameras.camera.position.clone();
  train.position.set(700, 0, 140);
  cameras.update(train, eye, 1 / 60);
  assert.ok(cameras.camera.position.equals(stationView));
  cameras.fitMap(train.position, train.position, 530, true);
  for (let frame = 0; frame < 60; frame++) cameras.update(train, eye, 1 / 60);
  train.position.x += 1;
  cameras.update(train, eye, 1 / 60);
  assert.equal(cameras.camera.position.x, 701);
});
