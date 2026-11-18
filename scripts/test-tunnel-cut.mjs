import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { createCanvas } from '@napi-rs/canvas';
import { Mesh, ShaderLib, SRGBColorSpace } from 'three';
import { Rail } from '../src/rail.ts';
import { createScenery } from '../src/scenery.ts';
import { tunnelCutField } from '../src/tunnel-cut.ts';

test('cut masks select an approach rock face and apron from the actual tunnel mouths', () => {
  const rail = new Rail([
    {distance:0,east:0,north:0,height:20},
    {distance:500,east:500,north:0,height:20},
  ]);
  const spans = [{start:100,end:300,tunnel:true},{start:300,end:350,tunnel:true}];
  const field = tunnelCutField(rail, spans);
  assert.ok(field);
  const sample = (x, y, z, dx, dz) => {
    const result = [];
    field(x, y, z, dx, dz, result);
    return result;
  };
  assert.deepEqual(sample(290, 37, 7, 5.4, 0), [0, 0]);
  assert.deepEqual(sample(485, 37, 7, 5.4, 0), [0, 0]);
  assert.equal(sample(375, 35, 14, 5.4, 0)[0], 255);
  assert.equal(sample(375, 35, 14, 0.6, 0)[0], 0);
  assert.equal(sample(360, 21, 6, 0.6, 0)[1], 255);
  assert.equal(sample(360, 21, 2.5, 0.6, 0)[1], 0);
  assert.equal(tunnelCutField(rail, []), undefined);
});

test('production R40 tunnel geometry shares the material and includes local cut-only attributes', async () => {
  globalThis.document = {createElement: () => createCanvas(1,1)};
  const bytes = await readFile(new URL('../public/data/r40/network/R40/R40-002.json.gz', import.meta.url));
  const data = JSON.parse(gunzipSync(bytes));
  const rail = new Rail(data.rail);
  const scenery = createScenery(data, rail, {polished:true});
  const ground = scenery.group.getObjectByName('Graded Copernicus DEM').children;
  const dressed = [...ground, ...scenery.group.children.filter(mesh =>
    mesh instanceof Mesh && mesh.name === 'Tunnel portal' && mesh.geometry.getAttribute('tunnelCut'))];
  assert.ok(ground.length > 0);
  assert.ok(dressed.length > ground.length);
  const phong = ground[0].material;
  assert.ok(dressed.every(mesh => mesh.material === phong));
  let rock = 0;
  let scree = 0;
  let ordinary = 0;
  for (const mesh of dressed) {
    const attribute = mesh.geometry.getAttribute('tunnelCut');
    assert.equal(attribute.count, mesh.geometry.getAttribute('position').count);
    assert.ok(attribute.normalized && attribute.array instanceof Uint8Array);
    for(let i = 0; i < attribute.count; i++) {
      if (attribute.getX(i) > .35) rock++;
      if (attribute.getY(i) > .2) scree++;
      if (!attribute.getX(i) && !attribute.getY(i)) ordinary++;
    }
  }
  assert.ok(rock > 150 && scree > 40 && ordinary > rock + scree);
  const shader = {vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader,uniforms:{}};
  phong.onBeforeCompile(shader);
  assert.match(shader.vertexShader, /attribute vec2 tunnelCut/);
  assert.match(shader.fragmentShader, /float foliation = fold/);
  assert.match(shader.fragmentShader, /float groundPatch\(vec2 p\)/);
  assert.match(shader.fragmentShader, /1\.0 - cover \* \.45/);
  assert.match(shader.fragmentShader, /normal, cutRelief, faceDirection/);
  assert.match(phong.customProgramCacheKey(), /tunnel-cut-foliation/);
  const wings = scenery.group.children.filter(mesh => mesh.material?.name === 'Coursed tunnel wing stone');
  assert.equal(wings.length, 2);
  assert.ok(wings.every(mesh => mesh.material.map.colorSpace === SRGBColorSpace && mesh.geometry.getAttribute('uv')));
  scenery.dispose();
});
