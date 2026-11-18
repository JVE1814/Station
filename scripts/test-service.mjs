import test from 'node:test';
import assert from 'node:assert/strict';
import { Service } from '../src/service.ts';
import { Rail } from '../src/rail.ts';

const rail = new Rail([
  { distance: 0, east: 0, north: 0, height: 0 },
  { distance: 2300, east: 0, north: 2300, height: 0 },
]);
const data = {
  stations: [
    { name: 'Fixture departure', stopDistance: 100 },
    { name: 'Fixture arrival', stopDistance: 2200 },
  ],
  spans: [
    { start: 0, end: 900, speedLimit: 100 },
    { start: 900, end: 2300, speedLimit: 55 },
  ],
};

test('automatic service slows for a lower limit and stops near the marker', () => {
  const service = new Service(data, rail);
  service.automatic = true;
  for (let second = 0; service.nextStop && second < 480; second++) {
    const state = service.tick(1);
    const limit = state.distance < 900 ? 100 : 55;
    assert.ok(state.speed * 3.6 <= limit + 0.5);
  }
  assert.equal(service.nextStop, undefined);
  assert.ok(Math.abs(service.stoppingError) <= 5);
});
