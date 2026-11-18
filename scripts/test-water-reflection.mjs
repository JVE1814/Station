import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene } from 'three';
import { WaterReflection, decorrelateWaterNormals } from '../src/water-reflection.ts';

function fixture() {
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 500);
  camera.position.set(0, 6, 12);
  camera.lookAt(0, 0, 0);
  const material = new MeshStandardMaterial();
  const water = new Mesh(new PlaneGeometry(34, 40), material);
  water.rotation.x = -Math.PI / 2;
  scene.add(water);
  const reflection = new WaterReflection();
  const unregister = reflection.register(water, 0);
  return { camera, material, reflection, scene, unregister, water };
}

function renderer(draw) {
  let target = null;
  return {
    xr: { enabled: true },
    shadowMap: { autoUpdate: true },
    state: { buffers: { depth: { setMask() {} } } },
    getDrawingBufferSize(size) { size.set(1920, 1080); },
    getRenderTarget() { return target; },
    setRenderTarget(next) { target = next; },
    render(scene, camera) { draw(scene, camera, target); },
    autoClear: true,
  };
}

test('reflection reuses one terrain pass, hides water during capture and restores renderer state', () => {
  const { camera, reflection, scene, unregister, water } = fixture();
  let captures = 0;
  const rendererState = renderer((_scene, mirror, target) => {
    assert.ok(Math.abs(mirror.position.y + 6) < 1e-9);
    assert.equal(water.visible, false);
    assert.equal(target.width, 480);
    assert.equal(target.height, 270);
    captures++;
  });
  assert.equal(reflection.render(rendererState, scene, camera, 'low'), false);
  assert.equal(reflection.render(rendererState, scene, camera, 'high'), true);
  assert.equal(captures, 1);
  assert.equal(water.visible, true);
  assert.equal(rendererState.getRenderTarget(), null);
  assert.equal(rendererState.xr.enabled, true);
  assert.equal(rendererState.shadowMap.autoUpdate, true);
  unregister();
  assert.equal(reflection.render(rendererState, scene, camera, 'high'), false);
  reflection.dispose();
});

test('failure during the mirror pass also recovers water and renderer state', () => {
  const { camera, reflection, scene, water } = fixture();
  const rendererState = renderer(() => { throw new Error('lost framebuffer'); });
  assert.throws(() => reflection.render(rendererState, scene, camera, 'high'), /lost framebuffer/);
  assert.equal(water.visible, true);
  assert.equal(rendererState.getRenderTarget(), null);
  assert.equal(rendererState.xr.enabled, true);
  assert.equal(rendererState.shadowMap.autoUpdate, true);
  reflection.dispose();
});

test('projective water shader retains the existing material hook and rotates the second normal sample', () => {
  const material = new MeshStandardMaterial();
  material.onBeforeCompile = shader => { shader.uniforms.base = { value: 1 }; };
  decorrelateWaterNormals(material);
  const reflection = new WaterReflection();
  const water = new Mesh(new PlaneGeometry(8, 11), material);
  reflection.register(water, 0);
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <worldpos_vertex>',
    fragmentShader: '#include <common>\n#include <normal_fragment_maps>\n#include <opaque_fragment>',
  };
  material.onBeforeCompile(shader, {});
  assert.equal(shader.uniforms.base.value, 1);
  assert.ok(shader.uniforms.lakeMirror.value.isTexture);
  assert.match(shader.vertexShader, /lakeProjection \* lakeWorld/);
  assert.match(shader.fragmentShader, /rotation \* vNormalMapUv \* 1.719/);
  assert.match(shader.fragmentShader, /texture2D\(lakeMirror,/);
  reflection.dispose();
});
