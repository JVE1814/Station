import test from 'node:test';
import assert from 'node:assert/strict';
import { COMFORT_JERK, STEP, FixedSimulation, stepTrain } from '../src/dynamics.ts';

const initial = { distance: 0, speed: 0, acceleration: 0, elapsed: 0 };
const traction = { throttle: 1, brake: 0, doorsOpen: false };

test('traction changes acceleration within the service jerk limit', () => {
  let state = initial;
  for (let index = 0; index < 1200; index++) {
    const next = stepTrain(state, traction, 0);
    assert.ok(Math.abs(next.acceleration - state.acceleration) / STEP <= COMFORT_JERK + 1e-10);
    assert.ok(next.distance > state.distance);
    state = next;
  }
  assert.ok(state.speed > 5);
});

test('interpolated pose is independent of render frame subdivision', () => {
  const subdivided = new FixedSimulation(initial);
  const batched = new FixedSimulation(initial);
  const update = state => stepTrain(state, traction, 0);
  for (let frame = 0; frame < 60; frame++) subdivided.advance(1 / 60, update);
  const pose = subdivided.advance(1 / 180, update);
  const batch = batched.advance(1 + 1 / 180, update);
  assert.ok(Math.abs(pose.distance - batch.distance) < 1e-9);
});

test('open doors interlock traction when stopped', () => {
  assert.equal(stepTrain(initial, { ...traction, doorsOpen: true }, -0.02).distance, 0);
});
