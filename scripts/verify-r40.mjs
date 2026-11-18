import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import proj4 from 'proj4';
import { Rail } from '../src/rail.ts';

const root = new URL('../public/data/r40/', import.meta.url);
const load = async (location) => {
  const asset = new URL(location, root);
  const raw = await readFile(asset);
  return JSON.parse(asset.pathname.endsWith('.gz') ? gunzipSync(raw) : raw);
};

const manifest = await load('network.json');
const [line] = manifest.services;
assert.equal(manifest.services.length, 1);
assert.equal(line.ref, 'R40');
assert.equal(line.sourceRelation, 18567357);
assert.match(manifest.elevationSource, /^https:\/\/nedlasting\.geonorge\.no\/.+\/DTM1\.atom$/);
const revision = await load('../../../data/r40-kartverket-source.json');
assert.equal(revision.feed, manifest.elevationSource);
assert.equal(revision.sourcePixelSizeMetres, 1);
assert.ok(revision.sources.length >= 2 && revision.sources.every(source =>
  source.bytes > 0 && /^".+"$/.test(source.etag) && new URL(source.url).hostname === 'nedlasting.geonorge.no'));
const route = await load(line.sourcePathUrl);

const stopIds = [431921002, 432630619, 5594658999, 4893194280];
assert.deepEqual(route.relationStops, stopIds);
assert.deepEqual(line.stations.map(station => station.stopOsmId), stopIds);
assert.equal(line.stations[0].stopDistance > 75, true);
assert.equal(line.length - line.stations.at(-1).stopDistance > 75, true);
const projection = proj4('EPSG:4326', line.projection);
const projectedSources = route.sourcePath.map(item => projection.forward(item.point));
for (let index = 1; index < route.sourcePath.length; index++) {
  const previous = route.sourcePath[index - 1];
  const next = route.sourcePath[index];
  const sourceWay = route.ways[next.way];
  assert.equal(sourceWay.tags.railway, 'rail');
  const a = sourceWay.nodeIds.indexOf(previous.node);
  const b = sourceWay.nodeIds.indexOf(next.node);
  assert.ok(a >= 0 && b >= 0 && Math.abs(b - a) === 1,
    `Disconnected OSM edge ${previous.node} → ${next.node}`);
  assert.deepEqual(sourceWay.points[a], previous.point);
  assert.deepEqual(sourceWay.points[b], next.point);
}

const rail = new Rail(line.rail);
let index = 1;
let maximumTrackOffset = 0;
for (let distance = 0; distance <= rail.length; distance += 2) {
  const point = rail.position(distance);
  while (index < route.sourcePath.length - 1 && route.sourcePath[index].distance < distance) index++;
  const a = projectedSources[index - 1];
  const b = projectedSources[index];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const x = point.x - a[0];
  const y = -point.z - a[1];
  const squared = dx * dx + dy * dy;
  const ratio = squared ? Math.min(1, Math.max(0, (x * dx + y * dy) / squared)) : 0;
  maximumTrackOffset = Math.max(maximumTrackOffset, Math.hypot(x - dx * ratio, y - dy * ratio));
}
assert.ok(maximumTrackOffset <= 5, `Track source deviation ${maximumTrackOffset} m`);

let maximumStationOffset = 0;
for (const station of line.stations) {
  assert.equal(station.name, station.sourceTags.name);
  assert.ok(['station', 'halt'].includes(station.sourceTags.railway));
  const source = projection.forward(station.sourcePosition);
  maximumStationOffset = Math.max(maximumStationOffset,
    Math.hypot(source[0] - station.position[0], source[1] - station.position[1]));
  const stopNode = route.sourcePath.find(item => item.node === station.stopOsmId);
  assert.ok(stopNode && Math.abs(stopNode.distance - station.stopDistance) <= 0.0001,
    `Station ${station.name} is missing its exact source call node`);
}
assert.ok(maximumStationOffset <= 25, `Station source deviation ${maximumStationOffset} m`);

let nextStart = 0;
let previousEnd;
const featureTypes = new Set();
for (const descriptor of line.tiles) {
  assert.equal(descriptor.start, nextStart);
  const tile = await load(descriptor.url);
  assert.equal(tile.start, descriptor.start);
  assert.equal(tile.end, descriptor.end);
  const endpoint = ({ east, north, height }) => [east, north, height];
  assert.equal(tile.rail[0].distance, 0);
  if (previousEnd) assert.deepEqual(endpoint(tile.rail[0]), previousEnd);
  previousEnd = endpoint(tile.rail.at(-1));
  assert.ok(Math.abs(tile.rail.at(-1).distance - (tile.end - tile.start)) <= 0.0001);
  const { width, height, spacing, samples } = tile.terrain;
  assert.equal(spacing, 8);
  assert.equal(samples.length, width * height);
  assert.ok(samples.every(sample => Number.isFinite(sample) && sample > -100 && sample < 6000),
    `Terrain tile ${descriptor.id} contains undefined source elevation`);
  for (const feature of tile.features) featureTypes.add(feature.type);
  nextStart = descriptor.end;
}
assert.equal(nextStart, line.length);
for (const kind of ['platform', 'building', 'water', 'forest', 'signal']) assert.ok(featureTypes.has(kind));
assert.ok(line.spans.some(span => span.bridge));
assert.ok(line.spans.some(span => span.tunnel));
assert.ok(line.spans.every(span => span.electrified));

const [dated] = await load('timetables.json');
assert.equal(dated.date, '20261118');
assert.equal(dated.line, 'R40');
assert.match(dated.sha256, /^[a-f0-9]{64}$/);
assert.deepEqual(line.timetable, dated.selected);
assert.ok(dated.journeys.some(journey => journey.direction === -1));
assert.ok(dated.journeys.some(journey => journey.direction === 1));
assert.deepEqual(dated.selected.calls.map(call => call.stationOsmId), line.stations.map(station => station.osmId));
let priorDeparture = '00:00:00';
for (const call of line.timetable.calls) {
  assert.ok(call.arrival >= priorDeparture && call.departure >= call.arrival);
  assert.ok(call.sourceStop && call.matchDistance <= 350);
  priorDeparture = call.departure;
}

const distance = line.stations.at(-1).stopDistance - line.stations[0].stopDistance;
console.log(`R40 ${line.stations.map(station => station.name).join(' → ')}: ${(distance / 1000).toFixed(3)} km, ${line.tiles.length} local Kartverket DTM1 tiles`);
console.log(`R40 maximum OSM track deviation ${maximumTrackOffset.toFixed(4)} m, station position deviation ${maximumStationOffset.toFixed(4)} m; every source call present`);
console.log(`Entur ${dated.date}: ${dated.selected.departure}–${dated.selected.arrival}, ${dated.selected.calls.length} calls, ${dated.journeys.length} dated journeys`);
