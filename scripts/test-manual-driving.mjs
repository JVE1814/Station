import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Rail } from '../src/rail.ts';
import { Service } from '../src/service.ts';
import { manualNotches } from './manual-driving.mjs';

test('manual R40 inputs stop at Bulken at several HUD polling intervals', async () => {
  const data = JSON.parse(await readFile(new URL('../public/data/service.json', import.meta.url), 'utf8'));
  const rail = new Rail(data.rail);
  for (const interval of [0.16, 0.5, 0.9, 1.2, 1.8]) {
    const service = new Service(data, rail);
    for (let tick = 0; service.nextStop && tick * interval < 480; tick++) {
      const speed = Math.round(service.state.speed * 3.6);
      const remaining = Math.round(service.nextStop.stopDistance - service.chainage());
      const notches = manualNotches(speed, remaining, service.trackSpan.speedLimit ?? 70);
      service.controls.throttle = notches.traction / 5;
      service.controls.brake = notches.brake / 5;
      if (remaining <= 5 && speed === 0 && !service.controls.doorsOpen) service.toggleDoors();
      service.tick(interval);
    }
    assert.equal(service.nextStop, undefined, `${interval}s control interval`);
    assert.ok(Math.abs(service.stoppingError) <= 7);
    assert.equal(service.emergencyStops, 0);
  }
});
