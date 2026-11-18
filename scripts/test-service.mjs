import test from 'node:test';
import assert from 'node:assert/strict';
import { Service } from '../src/service.ts';
import { Rail } from '../src/rail.ts';

const rail = new Rail([
  { distance: 0, east: 0, north: 0, height: 0 },
  { distance: 2300, east: 0, north: 2300, height: 0 },
]);
const data = {
  features: [],
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

test('changing ends mirrors the lead reference onto the same physical alignment', () => {
  const reversed = new Rail([
    { distance: 0, east: 0, north: 0, height: 0 },
    { distance: 750, east: 750, north: 0, height: 0 },
    { distance: 1400, east: 100, north: 0, height: 0 },
  ]);
  const service = new Service({
    features: [],
    spans: [
      { start: 0, end: 750, speedLimit: 65, osmWay: 33, direction: 'forward' },
      { start: 750, end: 1400, speedLimit: 65, osmWay: 33, direction: 'backward' },
    ],
    stations: [
      { osmId: 1, name: 'Fixture departure', stopDistance: 100 },
      { osmId: 2, name: 'Fixture reversal', stopDistance: 750, reversal: true },
      { osmId: 3, name: 'Fixture arrival', stopDistance: 1320 },
    ],
  }, reversed);
  service.automatic = true;
  for (let tick = 0; !service.reversals && tick < 5000; tick++) service.tick(0.05);
  assert.equal(service.reversals, 1);
  const oldRear = reversed.position(service.state.distance - 49.2);
  const newLead = reversed.position(service.chainage());
  assert.ok(oldRear.distanceTo(newLead) < 0.01);
  for (let tick = 0; service.nextStop && tick < 5000; tick++) service.tick(0.05);
  assert.equal(service.nextStop, undefined);
  assert.equal(service.emergencyStops, 0);
});
