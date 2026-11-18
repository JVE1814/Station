import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import proj4 from 'proj4';
import { COMFORT_JERK } from '../src/dynamics.ts';
import { Rail } from '../src/rail.ts';
import { Service } from '../src/service.ts';
import { Traffic } from '../src/traffic.ts';

const base = process.env.STATION_DATA_DIR ?? 'public/data';
const read = async relative => {
  const bytes = await readFile(`${base}/${relative}`);
  return JSON.parse(relative.endsWith('.gz') ? gunzipSync(bytes) : bytes);
};
let network;
try {
  network = await read('network.json');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  throw new Error('Full network coverage is pending. The baked station pair alone cannot verify F4, F5 and F6.');
}
const timetable = await read('timetables.json');
const references = ['F4', 'F5', 'F6'];

function segmentDistance(east, north, from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const x = east - from[0];
  const y = north - from[1];
  const squared = dx * dx + dy * dy;
  const fraction = squared ? Math.min(1, Math.max(0, (x * dx + y * dy) / squared)) : 0;
  return Math.hypot(x - dx * fraction, y - dy * fraction);
}

async function verifyGeography(route) {
  const transform = proj4('EPSG:4326', route.projection);
  const { sourcePath, ways } = await read(route.sourcePathUrl);
  assert.ok(sourcePath.length > 100, `Missing original source path for ${route.ref}`);
  const vertices = sourcePath.map(entry => transform.forward(entry.point));
  const wayNodeIndices = new Map();
  for (let index = 1; index < sourcePath.length; index++) {
    const from = sourcePath[index - 1];
    const to = sourcePath[index];
    const sourceWay = ways[to.way];
    assert.equal(sourceWay.tags.railway, 'rail', `Inactive OSM way ${to.way}`);
    if (!wayNodeIndices.has(to.way)) {
      wayNodeIndices.set(to.way, new Map(sourceWay.nodeIds.map((id, order) => [id, order])));
    }
    const order = wayNodeIndices.get(to.way);
    assert.equal(Math.abs(order.get(from.node) - order.get(to.node)), 1,
      `Source path step does not follow consecutive OSM nodes ${from.node} and ${to.node}`);
  }

  let sourceIndex = 0;
  let maxTrackError = 0;
  for (const sample of route.rail) {
    while (sourceIndex + 2 < sourcePath.length && sourcePath[sourceIndex + 1].distance < sample.distance) sourceIndex++;
    maxTrackError = Math.max(maxTrackError,
      segmentDistance(sample.east, sample.north, vertices[sourceIndex], vertices[sourceIndex + 1]));
  }
  let maxStationError = 0;
  for (const station of route.stations) {
    assert.equal(station.name, station.sourceTags.name, `OSM name differs at station ${station.osmId}`);
    const sourcePosition = transform.forward(station.sourcePosition);
    maxStationError = Math.max(maxStationError,
      Math.hypot(station.position[0] - sourcePosition[0], station.position[1] - sourcePosition[1]));
  }
  assert.ok(maxTrackError <= 5, `${route.ref} maximum track error ${maxTrackError} m`);
  assert.ok(maxStationError <= 25, `${route.ref} maximum station error ${maxStationError} m`);
  assert.ok(new Set(route.stations.map(station => station.osmId)).size === route.stations.length);

  let end = 0;
  let lastPoint = null;
  for (const tile of route.tiles) {
    assert.ok(Math.abs(tile.start - end) < 0.001, `${tile.id} breaks interval coverage`);
    const payload = await read(tile.url);
    const first = payload.rail[0];
    assert.equal(first.distance, 0, `${tile.id} must use local chainage`);
    if (lastPoint) {
      assert.deepEqual([first.east, first.north, first.height], lastPoint, `${tile.id} has a geometry seam`);
    }
    const last = payload.rail.at(-1);
    lastPoint = [last.east, last.north, last.height];
    assert.ok(Math.abs(last.distance - (tile.end - tile.start)) < 0.001);
    assert.equal(payload.terrain.samples.length, payload.terrain.width * payload.terrain.height);
    end = tile.end;
  }
  assert.ok(Math.abs(end - route.length) < 0.001, `${route.ref} is not tiled to the end of the route`);
  console.log(`${route.ref}: ${route.stations.length} OSM stations, ${route.tiles.length} complete tiles, ${(route.length / 1000).toFixed(2)} km.`);
  console.log(`  Maximum horizontal error ${maxTrackError.toFixed(4)} m rail, ${maxStationError.toFixed(4)} m station.`);
}

function verifyRun(route) {
  const table = timetable.find(record => record.line === route.ref);
  assert.ok(table?.selected.calls?.length > 2, `${route.ref} is missing dated GTFS calls`);
  const data = { ...route, service: route.ref, timetable: table.selected };
  const rail = new Rail(route.rail);
  const service = new Service(data, rail);
  const traffic = new Traffic(data, rail, service, table.journeys.filter(trip => trip.direction === 1));
  service.automatic = true;
  let last = service.state;
  let jerk = 0;
  let seconds = 0;
  const interval = 0.25;
  for (; service.nextStop && seconds < 36_000; seconds += interval) {
    const state = service.tick(interval);
    traffic.update(state.elapsed, interval);
    assert.ok(state.distance >= last.distance && state.distance - last.distance <= Math.max(last.speed, state.speed) * interval + 0.01,
      `${route.ref} moved discontinuously at ${state.distance.toFixed(2)} m`);
    jerk = Math.max(jerk, Math.abs(last.acceleration - state.acceleration) / interval);
    last = state;
  }
  assert.equal(service.nextStop, undefined, `${route.ref} did not reach its final scheduled stop: ${service.nextStop?.name}`);
  assert.deepEqual(service.arrivals.map(call => call.stationOsmId), table.selected.calls.slice(1).map(call => call.stationOsmId));
  const aiEmergencies = traffic.emergencyStops + traffic.active.reduce((count, train) => count + train.emergencyStops, 0);
  assert.equal(service.emergencyStops + aiEmergencies, 0, `${route.ref} needed an emergency occupancy stop`);
  assert.ok(jerk <= COMFORT_JERK + 1e-6, `${route.ref} jerk ${jerk}`);
  const stopping = Math.max(...service.arrivals.map(call => Math.abs(call.error)));
  console.log(`  Autopilot: ${service.arrivals.length} calls after departure, ${traffic.departures} scheduled AI trains, ${stopping.toFixed(2)} m worst stop, ${jerk.toFixed(3)} m/s³ peak jerk.`);
}

for (const reference of references) {
  const route = network.services.find(item => item.ref === reference);
  assert.ok(route && route.stations.length > 2 && route.tiles.length > 0, `Missing baked coverage for ${reference}`);
  await verifyGeography(route);
  verifyRun(route);
}
