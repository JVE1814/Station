import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import proj4 from 'proj4';
import { COMFORT_JERK } from '../src/dynamics.ts';
import { Rail } from '../src/rail.ts';
import { Service } from '../src/service.ts';

const world = JSON.parse(await readFile('public/data/service.json', 'utf8'));
const coordinate = proj4('EPSG:4326', world.projection);
const points = world.sourcePath.map(node => coordinate.forward(node.point));
const stationError = Math.max(...world.stations.map(station => {
  assert.equal(station.name, station.sourceTags.name, `OSM station name ${station.osmId}`);
  const [east, north] = coordinate.forward(station.sourcePosition);
  return Math.hypot(east - station.position[0], north - station.position[1]);
}));
function segmentDistance(east, north, start, end) {
  const x = end[0] - start[0];
  const y = end[1] - start[1];
  const dx = east - start[0];
  const dy = north - start[1];
  const squared = x * x + y * y;
  const t = squared === 0 ? 0 : Math.max(0, Math.min(1, (dx * x + dy * y) / squared));
  return Math.hypot(dx - t * x, dy - t * y);
}
const rail = new Rail(world.rail);
let trackError = 0;
for (let distance = 0; distance <= rail.length; distance += 2) {
  const point = rail.position(distance);
  let minimum = Infinity;
  for (let segment = 1; segment < points.length; segment++) {
    minimum = Math.min(minimum, segmentDistance(point.x, -point.z, points[segment - 1], points[segment]));
  }
  trackError = Math.max(trackError, minimum);
}
assert.ok(stationError <= 25, `Station error ${stationError} m exceeds 25 m`);
assert.ok(trackError <= 5, `Track error ${trackError} m exceeds 5 m`);
console.log(`${world.stations.length} OSM station names match. Maximum displacement ${stationError.toFixed(3)} m.`);
console.log(`Maximum horizontal rail displacement ${trackError.toFixed(3)} m.`);

const service = new Service(world, rail);
service.automatic = true;
let previous = service.state;
let jerk = 0;
let observedAcceleration = 0;
let duration = 0;
for (; service.nextStop && duration < 1200; duration += 0.05) {
  const state = service.tick(0.05);
  assert.ok(state.distance >= previous.distance, 'Train position reversed');
  assert.ok(state.distance - previous.distance <= Math.max(state.speed, previous.speed) * 0.05 + 0.001, 'Train position jumped');
  const rate = (state.speed - previous.speed) / 0.05;
  jerk = Math.max(jerk, Math.abs(state.acceleration - previous.acceleration) / 0.05,
    Math.abs(rate - observedAcceleration) / 0.05);
  observedAcceleration = rate;
  previous = state;
}
assert.equal(service.nextStop, undefined, 'Autopilot did not complete');
assert.equal(service.emergencyStops, 0);
assert.ok(jerk <= COMFORT_JERK + 1e-6, `Peak jerk ${jerk} m/s³ exceeds ${COMFORT_JERK}`);
console.log(`${world.service} autopilot: ${duration.toFixed(2)} s, ${Math.abs(service.stoppingError).toFixed(2)} m stopping error, ${jerk.toFixed(3)} m/s³ peak longitudinal jerk.`);
