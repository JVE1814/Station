import test from 'node:test';
import assert from 'node:assert/strict';
import { Layers, Matrix4, Texture, Vector3 } from 'three';
import { createTrain, ROLLING_STOCK_SHADOW_LAYER } from '../src/rolling-stock.ts';

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
