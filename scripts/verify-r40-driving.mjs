import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { COMFORT_JERK } from '../src/dynamics.ts';
import { Rail } from '../src/rail.ts';
import { Service } from '../src/service.ts';
import { Traffic } from '../src/traffic.ts';

const root = process.argv[2] ? pathToFileURL(resolve(process.argv[2]) + '/') : new URL('../public/data/r40/', import.meta.url);
const read = async name => JSON.parse(await readFile(new URL(name, root), 'utf8'));
const [network, timetables] = await Promise.all([read('network.json'), read('timetables.json')]);
const route = network.services.find(service => service.ref === 'R40');
const timetable = timetables.find(record => record.line === 'R40');
assert.ok(route && timetable, 'Evanger–Voss service and its dated timetable are required');
const data = { ...route, service: route.ref, timetable: timetable.selected };
const rail = new Rail(data.rail);

function manualInput(service) {
  if (service.controls.doorsOpen) {
    if (service.boardingRemaining === 0) service.toggleDoors();
    return;
  }
  const { powerNotch, brakeNotch, recommendedSpeed } = service.preview.guidance;
  const set = (control, notch) => service.adjustNotch(control, notch / 5 - service.controls[control]);
  set('throttle', powerNotch);
  set('brake', brakeNotch);
  if (recommendedSpeed === 0 && service.canOpenDoors) service.toggleDoors();
}

function run(surface, automatic) {
  const service = new Service(data, rail, { driving: true });
  service.surface = surface;
  service.automatic = automatic;
  const traffic = new Traffic(data, rail, service, timetable.journeys.filter(trip => trip.direction === 1));
  let previousRate = 0;
  let peakJerk = 0;
  const interval = 0.05;
  const description = `R40 ${surface} ${automatic ? 'automatic' : 'advisory notches'}`;
  for (let tick = 0; service.nextStop && tick * interval < 1200; tick++) {
    if (!automatic && tick % 9 === 0) manualInput(service);
    const previous = service.state;
    const state = service.tick(interval);
    traffic.update(state.elapsed, interval);
    assert.ok(state.distance >= previous.distance, `${description} reversed`);
    assert.ok(state.distance - previous.distance <= Math.max(state.speed, previous.speed) * interval + 0.001,
      `${description} position jumped`);
    const actualRate = (state.speed - previous.speed) / interval;
    peakJerk = Math.max(peakJerk, Math.abs(state.acceleration - previous.acceleration) / interval,
      Math.abs(actualRate - previousRate) / interval);
    previousRate = actualRate;
    assert.equal(service.stopMissed, false, `${description} passed the ${service.nextStop?.name} platform`);
  }
  assert.equal(service.nextStop, undefined, `${description} failed to finish within 1200 simulated seconds`);
  assert.equal(service.emergencyStops, 0, `${description} made an emergency stop`);
  assert.ok(peakJerk <= COMFORT_JERK + 1e-6, `${description} peak jerk ${peakJerk} m/s³ exceeds ${COMFORT_JERK}`);
  assert.deepEqual(service.stopResults.map(stop => stop.station), ['Seimsgrend', 'Bulken', 'Voss']);
  assert.ok(service.stopResults.every(stop => Math.abs(stop.stoppingError) <= 7));
  assert.equal(service.stopResults.at(-1).aboard, 0);
  const stops = service.stopResults.map(stop => `${stop.station} ${Math.abs(stop.stoppingError).toFixed(2)} m`).join(', ');
  console.log(`${description} finished in ${service.state.elapsed.toFixed(2)} s, ${peakJerk.toFixed(3)} m/s³ peak jerk, ${stops}.`);
  console.log(`Grade ${service.finalResult.grade} (${service.finalResult.score}/100), ${service.finalResult.passengersCarried} passengers.`);
}

for (const surface of ['clear', 'rain', 'snow']) {
  run(surface, true);
  run(surface, false);
}
