import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let manifest;
try {
  manifest = JSON.parse(await readFile('public/data/network.json', 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  throw new Error('Full network coverage is pending. The baked station pair alone cannot verify F4, F5 and F6.');
}
for (const service of ['F4', 'F5', 'F6']) {
  const line = manifest.services.find(line => line.ref === service);
  assert.ok(line && line.stations.length > 2 && line.tiles.length > 0, `Missing baked coverage for ${service}`);
}
console.log('Full-service coverage manifest contains F4, F5 and F6.');
