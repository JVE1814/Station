import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvas } from '@napi-rs/canvas';
import { SpotLight } from 'three';
import { createCab, createTrain } from '../src/rolling-stock.ts';

test('the cab and leading coach share a tapered night headlight and weather response', (t) => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => {
    assert.equal(tag, 'canvas');
    return createCanvas(1, 1);
  } };
  t.after(() => { globalThis.document = originalDocument; });
  const leading = createTrain(true, undefined, true);
  const cab = createCab(undefined, true);
  const legacy = createTrain(true);
  const spot = ({ group }) => {
    let found;
    group.traverse(child => { if (child instanceof SpotLight) found = child; });
    assert.ok(found);
    return found;
  };
  const trainSpot = spot(leading);
  const cabSpot = spot(cab);
  const legacySpot = spot(legacy);
  assert.deepEqual(trainSpot.position.toArray(), cabSpot.position.toArray());
  assert.deepEqual(trainSpot.target.position.toArray(), cabSpot.target.position.toArray());
  assert.ok(trainSpot.distance < legacySpot.distance && trainSpot.intensity < legacySpot.intensity);
  assert.ok(trainSpot.penumbra > legacySpot.penumbra && trainSpot.decay > legacySpot.decay);
  const state = { speed: 1, brake: 0, throttle: 0, doorsOpen: false };
  for (const visual of [leading, cab]) {
    const light = spot(visual);
    const scattering = light.children[0].material.uniforms.beamScattering;
    visual.update({ ...state, night: false });
    assert.equal(light.visible, false);
    visual.update({ ...state, night: true, weather: 'clear' });
    assert.equal(light.visible, true);
    const clear = scattering.value;
    visual.update({ ...state, night: true, weather: 'rain' });
    assert.ok(scattering.value > clear);
    const rain = scattering.value;
    visual.update({ ...state, night: true, weather: 'snow' });
    assert.ok(scattering.value > rain);
  }
});
