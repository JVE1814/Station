import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { promisify } from 'node:util';

const run = promisify(execFile);
const base = process.env.STATION_DATA_DIR ?? 'public/data';
const manifest = JSON.parse(await readFile(`${base}/network.json`, 'utf8'));
const tiles = manifest.services.flatMap(service => service.tiles);
const failures = [];
let pointer = 0;
let checked = 0;
let probes = 0;
let bedSamples = 0;
let maxGap = 0;
const concurrency = Number(process.env.STATION_AUDIT_WORKERS ?? Math.min(4, availableParallelism()));
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
  throw new Error('Use one to four geometry audit workers');
}

async function worker() {
  while (pointer < tiles.length) {
    const tile = tiles[pointer++];
    try {
      const result = await run(process.execPath, ['scripts/verify-clearance.mjs', `${base}/${tile.url}`, '--json']);
      const { bed, body } = JSON.parse(result.stdout);
      probes += body.samples;
      bedSamples += bed.sampleCount;
      maxGap = Math.max(maxGap, bed.maxGap);
      console.log(`${tile.id}: ${bed.sampleCount} trackbed probes, ${bed.maxGap.toFixed(3)} m maximum gap, ${body.samples} clear coach probes.`);
    } catch (error) {
      failures.push(tile.id);
      const detail = error.stderr?.match(/AssertionError[^\n]*/)?.[0];
      console.error(`${tile.id} ${error.stdout?.trim() || error.message}${detail ? ` · ${detail}` : ''}`);
    }
    checked++;
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
console.log(`Rendered network clearance: ${checked} tiles audited, ${failures.length} failed.`);
if (failures.length) {
  console.error(failures.join(', '));
  process.exitCode = 1;
} else {
  console.log(`Network clearance: ${bedSamples} trackbed probes, ${maxGap.toFixed(3)} m maximum gap, zero missing.`);
  console.log(`Coach clearance: ${probes} probes, zero intersections with terrain, tunnels, buildings, signals, bridges, platforms or catenary supports.`);
}
