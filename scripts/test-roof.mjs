import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gabledRoof, roofTint } from '../src/roof.ts';

const area = ring => Math.abs(ring.reduce((sum, [x, y], index) => {
  const [u, v] = ring[(index + 1) % ring.length];
  return sum + x * v - y * u;
}, 0)) * 0.5;

test('gable divides an exact footprint into two sloped surfaces and closes the end walls', () => {
  const footprint = [[0, 0], [12, 0], [12, 7], [0, 7]];
  const roof = gabledRoof(footprint, 2.4);
  assert.ok(roof);
  assert.equal(roof.rim.length, 6);
  assert.equal(roof.heightAt([6, 3.5]), 2.4);
  assert.equal(roof.heightAt([6, 0]), 0);
  assert.equal(roof.faces.reduce((sum, face) => sum + area(face), 0), area(footprint));
  assert.ok(roof.faces.every(face => face.every(([x, y]) => x >= 0 && x <= 12 && y >= 0 && y <= 7)));
});

test('a re-entrant mapped footprint keeps its open corner', () => {
  const footprint = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 9], [0, 9]];
  const roof = gabledRoof(footprint, 1.8);
  assert.ok(roof);
  assert.equal(roof.faces.reduce((sum, face) => sum + area(face), 0), area(footprint));
  assert.ok(roof.faces.every(face => face.every(([x, y]) => x <= 4 || y <= 4)));
});

test('broad untagged flat roofs use a muted finish while source colours and material take precedence', () => {
  const outline = [[0, 0], [42, 0], [42, 32], [0, 32]];
  const finish = roofTint({}, 0x696466, true, outline).getHex();
  assert.ok(finish > 0xa0a0a0 && finish < 0xc4c3bb);
  assert.equal(roofTint({ 'roof:colour': '#495988' }, 0x696466, true, outline).getHex(), 0x495988);
  assert.equal(roofTint({ 'roof:material': 'zinc' }, 0x696466, true, outline).getHex(), 0xafb8b8);
  assert.equal(roofTint({}, 0x696466, false, outline).getHex(), 0x696466);
});
