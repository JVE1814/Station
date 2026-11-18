import test from 'node:test';
import assert from 'node:assert/strict';
import { Layers, Matrix4, Texture, Vector3 } from 'three';
import { createCab, createTrain, ROLLING_STOCK_SHADOW_LAYER } from '../src/rolling-stock.ts';

test('instanced passenger doors retain their material maps and cull-safe travel', () => {
  const brushedSteel = new Texture();
  const { group, update } = createTrain(false, brushedSteel);
  const doors = group.children.filter(item => item.isInstancedMesh);
  assert.deepEqual(doors.map(item => [item.count, item.castShadow, item.receiveShadow]), [
    [8, true, true], [8, true, true], [8, false, false],
  ]);
  assert.equal(doors[0].material.map, brushedSteel);
  assert.equal(doors[0].material.bumpMap, brushedSteel);
  for (const part of doors) {
    const vertices = part.geometry.attributes.position.count;
    assert.equal(part.geometry.attributes.normal.count, vertices);
    assert.equal(part.geometry.attributes.uv.count, vertices);
  }

  const matrix = new Matrix4();
  const position = (part, index) => {
    part.getMatrixAt(index, matrix);
    const instanceBounds = part.geometry.boundingBox.clone().applyMatrix4(matrix);
    assert.ok(part.boundingBox.containsBox(instanceBounds));
    return new Vector3().setFromMatrixPosition(matrix);
  };
  const closed = doors.map(part => Array.from({ length: part.count }, (_, index) => position(part, index)));

  const deltaSeconds = 0.12;
  const state = { speed: 0, brake: 1, throttle: 0, doorsOpen: true, night: false, doorSide: 1, deltaSeconds };
  update(state);
  for (const [partIndex, part] of doors.entries()) {
    for (const [index, initial] of closed[partIndex].entries()) {
      const open = position(part, index);
      const expected = index >= 4 ? (index % 2 ? 1 : -1) * 0.70 * (1 - Math.exp(-5.65 * deltaSeconds)) : 0;
      assert.ok(Math.abs(open.z - initial.z - expected) < 0.000002);
      assert.equal(open.x, initial.x);
      assert.equal(open.y, initial.y);
    }
  }
  update({ ...state, deltaSeconds: 10 });
  update({ ...state, doorsOpen: false, deltaSeconds: 10 });
  for (const [partIndex, part] of doors.entries()) {
    for (const [index, initial] of closed[partIndex].entries()) {
      assert.deepEqual(position(part, index), initial);
    }
  }
});

test('rigid body depth batches preserve the opaque shell and leave moving casters independent', () => {
  const { group } = createTrain(false);
  const normalView = new Layers();
  const shadowView = new Layers();
  shadowView.enable(ROLLING_STOCK_SHADOW_LAYER);
  const proxies = group.children.filter(item => item.isMesh && !item.layers.test(normalView));
  assert.equal(proxies.length, 1);
  const [proxy] = proxies;
  assert.ok(proxy.layers.test(shadowView) && proxy.castShadow);
  assert.equal(proxy.receiveShadow, false);
  assert.equal(proxy.geometry.groups.length, 0);
  assert.deepEqual(Object.keys(proxy.geometry.attributes), ['position']);

  const shell = group.children.find(item => item.isMesh && Array.isArray(item.material));
  assert.ok(shell.layers.test(normalView) && shell.receiveShadow);
  assert.equal(shell.castShadow, false);
  const shellTriangles = Array.from(shell.geometry.index.array);
  assert.deepEqual(Array.from(proxy.geometry.index.array.slice(0, shellTriangles.length)), shellTriangles);
  const shellVertices = shell.geometry.attributes.position.array;
  assert.deepEqual(proxy.geometry.attributes.position.array.slice(0, shellVertices.length), shellVertices);
  assert.ok(proxy.geometry.index.count > shellTriangles.length);

  const doorCasters = group.children.filter(item => item.isInstancedMesh && item.castShadow);
  assert.equal(doorCasters.length, 2);
  assert.ok(doorCasters.every(item => item.layers.test(normalView) && item.layers.test(shadowView)));
});

test('showpiece shell retains textured glazing and applies weather to paint and lights', () => {
  const { group, update } = createTrain(false, new Texture(), true);
  const shell = group.children.find(item => item.isMesh && Array.isArray(item.material));
  const paint = shell.material.find(material => material.isMeshPhysicalMaterial);
  assert.ok(paint.clearcoat > 0);
  assert.equal(shell.geometry.attributes.uv.count, shell.geometry.attributes.position.count);
  assert.equal(shell.geometry.attributes.color.count, shell.geometry.attributes.position.count);
  const glazing = group.children.find(item => item.material?.emissiveMap);
  assert.equal(glazing.geometry.attributes.uv.count, glazing.geometry.attributes.position.count);

  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>' };
  paint.onBeforeCompile(shader);
  const base = { speed: 0, throttle: 0, brake: 1, doorsOpen: false, night: false };
  update({ ...base, weather: 'rain' });
  assert.equal(shader.uniforms.stockSnow.value, 0);
  assert.equal(glazing.material.emissiveIntensity, 0.025);
  const wetRoughness = paint.clearcoatRoughness;
  update({ ...base, weather: 'snow', night: true });
  assert.ok(shader.uniforms.stockSnow.value > 0);
  assert.ok(paint.clearcoatRoughness > wetRoughness);
  assert.ok(glazing.material.emissiveIntensity > 1);
});

test('showpiece windscreen draws only in weather and parks both wipers in clear conditions', (t) => {
  const originalDocument = globalThis.document;
  t.after(() => { globalThis.document = originalDocument; });
  const context = new Proxy({}, { get: (_target, key) => key === 'createRadialGradient'
    ? () => ({ addColorStop() {} }) : () => {} });
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  const { group, update } = createCab(undefined, true);
  const pane = group.getObjectByName('Cab windscreen weather');
  const wipers = group.children.filter(item => item.name === 'Cab windscreen wiper');
  const parked = wipers.map(item => item.quaternion.clone());
  assert.equal(pane.visible, false);
  assert.equal(pane.geometry.attributes.uv.count, 4);
  assert.equal(wipers.length, 2);
  const state = { speed: 1, throttle: 0, brake: 0, doorsOpen: false, night: true, deltaSeconds: 0.45 };
  update({ ...state, weather: 'rain' });
  assert.equal(pane.visible, true);
  assert.equal(pane.material.depthWrite, false);
  assert.equal(pane.material.uniforms.rain.value, 1);
  assert.ok(wipers.every((item, index) => !item.quaternion.equals(parked[index])));
  update({ ...state, weather: 'snow' });
  assert.equal(pane.visible, true);
  assert.equal(pane.material.uniforms.rain.value, 0);
  update({ ...state, weather: 'clear' });
  assert.equal(pane.visible, false);
  assert.ok(wipers.every((item, index) => item.quaternion.angleTo(parked[index]) < 1e-7));
});
