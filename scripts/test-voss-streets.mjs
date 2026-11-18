import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const home = new URL('../public/data/r40/', import.meta.url);
const asset = async name => JSON.parse(await readFile(new URL(name, home)));

test('Voss street sidecar uses the dated R40 projection and mapped station radius', async () => {
  const [network, layout] = await Promise.all([asset('network.json'), asset('voss-streets.json')]);
  const station = network.services[0].stations.find(item => item.name === 'Voss');
  assert.equal(layout.version, 1);
  assert.equal(layout.projection, network.projection);
  assert.equal(layout.osmSnapshot, network.osmSnapshot);
  assert.equal(layout.stationOsmId, station.osmId);
  assert.deepEqual(layout.center, station.position);
  assert.equal(layout.radiusMetres, 500);
  assert.deepEqual(new Set(layout.streets.map(street => street.kind)), new Set(['road', 'access', 'path']));
  assert.ok(layout.streets.some(street => street.tags.name === 'Evangervegen'));
  assert.ok(layout.streets.some(street => street.tags.name === 'Vangsgata'));
  assert.ok(layout.streets.some(street => street.tags.service === 'parking_aisle'));
  let previous = [0, -1];
  for (const { osmId, part, points, widthMetres, tags } of layout.streets) {
    assert.ok(osmId > previous[0] || (osmId === previous[0] && part === previous[1] + 1));
    previous = [osmId, part];
    assert.ok(osmId > 0 && tags.highway && widthMetres >= 0.5 && widthMetres <= 20);
    assert.ok(points.length >= 2);
    for (const [east, north] of points) {
      assert.ok(Math.hypot(east - layout.center[0], north - layout.center[1]) <= layout.radiusMetres + .001);
    }
  }
});
