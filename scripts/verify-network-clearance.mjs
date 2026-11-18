import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);
const base = process.env.STATION_DATA_DIR ?? 'public/data';
const manifest = JSON.parse(await readFile(`${base}/network.json`, 'utf8'));
const tiles = manifest.services.flatMap(service => service.tiles);
const failures = [];
let pointer = 0;
let checked = 0;
const concurrency = Number(process.env.STATION_AUDIT_WORKERS ?? 2);
if (concurrency !== 1 && concurrency !== 2) throw new Error('Use one or two geometry audit workers');

async function worker() {
  while (pointer < tiles.length) {
    const tile = tiles[pointer++];
    try {
      const result = await run(process.execPath, ['scripts/verify-clearance.mjs', `${base}/${tile.url}`]);
      console.log(`${tile.id} ${result.stdout.trim().replaceAll('\n', ' · ')}`);
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
}
