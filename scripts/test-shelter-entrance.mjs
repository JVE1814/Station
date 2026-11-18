import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { Rail } from '../src/rail.ts';
import { sharedShelterEntrance } from '../src/scenery.ts';
import { groundHeight } from '../src/world-data.ts';

const tile = JSON.parse(gunzipSync(readFileSync(new URL(
  '../public/data/r40/network/R40/R40-002.json.gz', import.meta.url,
))));
const feature = osmId => tile.features.find(candidate => candidate.osmId === osmId);
const shelter = feature(512804977).points.slice(0, -1);
const outline = feature(512804978).points.slice(0, -1);
const deck = { outline, followsRail: true };

test('the Seimsgrend shelter opens into its mapped contiguous timber deck', () => {
  const entrance = sharedShelterEntrance(shelter, [deck]);
  assert.equal(entrance.deck, deck);
  assert.equal(entrance.index, 5);
  assert.ok(entrance.width > 2.2 && entrance.width < 2.22);
  const rail = new Rail(tile.rail);
  const localRail = Array.from({ length: 401 }, (_, index) => rail.position(7650 - tile.start + index / 10));
  const threshold = shelter[5].map((value, axis) => (value + shelter[0][axis]) / 2);
  const measured = ([x, north]) => localRail.reduce((nearest, point) => {
    const distance = Math.hypot(point.x - x, point.z + north);
    return !nearest || distance < nearest.distance ? { distance, elevation: point.y } : nearest;
  }, null);
  assert.ok(shelter.every(point => measured(point).distance > 3.7));
  const track = measured(threshold);
  assert.ok(track.distance > 3.7 && track.distance < 3.8);
  const height = track.elevation + 0.64;
  const rise = height - groundHeight(tile.terrain, ...threshold);
  assert.ok(rise > 0.6 && rise < 0.75);
  assert.ok([shelter[5], shelter[0]].every(point =>
    Math.abs(measured(point).elevation + 0.64 - height) < 0.03));
});

test('edge matching works with reversed rings and rejects an offset deck', () => {
  assert.equal(sharedShelterEntrance(shelter.toReversed(), [{ ...deck, outline: outline.toReversed() }]).width,
    sharedShelterEntrance(shelter, [deck]).width);
  const shifted = { ...deck, outline: outline.map(([x, north]) => [x + 0.1, north]) };
  assert.equal(sharedShelterEntrance(shelter, [shifted]), undefined);
});
