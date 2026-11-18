import assert from 'node:assert/strict';
import test from 'node:test';
import { Scene, ShaderLib, Vector3 } from 'three';
import { Atmosphere } from '../src/atmosphere.ts';

test('airborne rain and snow fade outside the cabin while exterior cameras keep near flakes', () => {
  const scene = new Scene();
  const weather = new Atmosphere(scene, 5, true);
  const particles = scene.getObjectByName('Airborne precipitation');
  const shader = { ...ShaderLib.points, uniforms: {} };
  particles.material.onBeforeCompile(shader);
  assert.match(shader.vertexShader, /particleRange = length\(mvPosition.xyz\)/);
  assert.match(shader.fragmentShader, /smoothstep\(airClearance, airClearance \+ 1.35, particleRange\)/);
  const train = new Vector3(0, 30, 0);
  const camera = new Vector3(0, 32.7, -9.3);
  weather.set(false, 'snow');
  weather.update(train, camera, .12, false, undefined, true);
  assert.ok(particles.visible && shader.uniforms.airClearance.value > 2.5);
  weather.update(train, camera, .12, false, undefined, false);
  assert.ok(particles.visible && shader.uniforms.airClearance.value < 1);
  weather.update(train, camera, .12, true, undefined, true);
  assert.equal(particles.visible, false);
});
