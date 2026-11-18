import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCanvas } from '@napi-rs/canvas';
import { MeshStandardMaterial } from 'three';
import { applyWaterBanks, createShorelineField } from '../src/lake-surface.ts';

test('water depths fade from the source banks and island holes independently of triangulation', (t) => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: () => createCanvas(1, 1) };
  t.after(() => { globalThis.document = oldDocument; });
  const terrain = { east: -90, north: 90, width: 31, height: 31, spacing: 6, samples: [] };
  const outline = [[-80, -72], [81, -72], [81, 73], [-80, 73]];
  const hole = [[-13, -10], [-13, 13], [12, 13], [12, -10]];
  const field = createShorelineField(terrain, [{ osmId: 1, type: 'water', points: outline, holes: [hole], tags: {} }]);
  const { width, height, data } = field.texture.image;
  const at = (east, north) => data[Math.floor((90 - north) * height / 180) * width + Math.floor((east + 90) * width / 180)];
  assert.equal(at(1, 1), 0);
  assert.equal(at(-86, 1), 0);
  assert.ok(at(17, 1) < at(30, 1));
  assert.ok(at(19, 1) < at(49, 1));
  assert.ok(at(49, 1) > 240);
  assert.ok(at(-49, 1) > 240);
  const material = new MeshStandardMaterial();
  applyWaterBanks(material, field);
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <worldpos_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>' };
  material.onBeforeCompile(shader, {});
  assert.equal(material.transparent, true);
  assert.ok(shader.uniforms.waterBankField.value.isDataTexture);
  assert.match(shader.fragmentShader, /texture2D\(waterBankField, waterBankUv\)/);
  material.dispose();
});
