import test from 'node:test';
import assert from 'node:assert/strict';
import { audioMixFor, createLakesideProfile, railJointsCrossed, StationAudio } from '../src/audio.ts';
import { Rail } from '../src/rail.ts';

const idle = {
  speed: 0, distance: 0, throttle: 0, brake: 0, doorsOpen: false, weather: 'clear', tunnel: false,
  bridge: false, lakeside: 0, view: 'cab', paused: false, timeScale: 1,
};

const mix = changes => audioMixFor({ ...idle, ...changes });

test('rolling, traction and braking follow motion, effort and door state', () => {
  assert.equal(mix({}).bogie, 0);
  assert.equal(mix({ brake: 1 }).brake, 0);
  assert.equal(mix({ speed: 22 }).torque, 0);
  assert.ok(mix({ speed: 22 }).tread > mix({ speed: 10 }).tread);
  assert.ok(mix({ speed: 10, throttle: 0.8 }).torque > mix({ speed: 10, throttle: 0.4 }).torque);
  assert.ok(mix({ speed: 22, throttle: 0.8 }).tone > mix({ speed: 10, throttle: 0.8 }).tone);
  assert.equal(mix({ speed: 0, throttle: 0.8, doorsOpen: true }).torque, 0);
  assert.ok(mix({ speed: 4, brake: 0.8 }).squeal > mix({ speed: 22, brake: 0.8 }).squeal);
  assert.equal(mix({ speed: 22, throttle: 0.8, brake: 0.8 }).torque, 0);
  assert.ok(mix({ speed: 22, bridge: true }).bogie > mix({ speed: 22 }).bogie);
});

test('weather, tunnels, the lakeshore and the camera change the mix', () => {
  assert.equal(mix({}).rain, 0);
  assert.ok(mix({ weather: 'rain' }).rain > mix({ weather: 'rain', tunnel: true }).rain * 10);
  assert.ok(mix({ weather: 'snow', speed: 20 }).tread < mix({ speed: 20 }).tread);
  assert.ok(mix({ weather: 'snow' }).wind > mix({}).wind);
  assert.ok(mix({ lakeside: 1, view: 'chase' }).shore > mix({ lakeside: 1 }).shore);
  assert.ok(mix({ view: 'cab' }).cutoff < mix({ view: 'chase' }).cutoff);
  assert.ok(mix({ view: 'map' }).train < mix({ view: 'cab' }).train);
  assert.ok(mix({ tunnel: true }).tunnel > mix({}).tunnel);
  assert.equal(mix({ paused: true, weather: 'rain' }).master, 0);
});

test('rail joint sounds trigger once crossing each joint and skip a seek', () => {
  assert.deepEqual(railJointsCrossed(39, 41), []);
  assert.deepEqual(railJointsCrossed(41, 42), [42]);
  assert.deepEqual(railJointsCrossed(42, 45), []);
  assert.deepEqual(railJointsCrossed(437, 441), [440]);
  assert.deepEqual(railJointsCrossed(37, 667), []);
  assert.deepEqual(railJointsCrossed(44, 21), []);
});

test('lakeside intensity is sampled from the mapped shoreline', () => {
  const rail = new Rail([
    { distance: 0, east: 0, north: 0, height: 0 },
    { distance: 1000, east: 1000, north: 0, height: 0 },
  ]);
  const features = [{ type: 'water', points: [[275, 30], [650, 30], [650, 290], [275, 290]] }];
  const at = createLakesideProfile({ features }, rail);
  assert.equal(at(0), 0);
  assert.ok(at(170) > 0 && at(170) < at(280));
  assert.ok(at(450) > 0.9);
  assert.ok(Math.abs(at(260.001) - at(259.999)) < 0.0001);
  assert.equal(at(1000), 0);
  assert.equal(createLakesideProfile({ features: [] }, rail)(450), 0);
});

test('updating sound is safe before a user gesture or without Web Audio', () => {
  const audio = new StationAudio();
  audio.update(idle);
  audio.setMuted(true);
  audio.unlock();
  audio.horn();
  audio.update({ ...idle, speed: 12 });
});
