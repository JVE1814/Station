import { spawnSync } from 'node:child_process';

const failures = [];
const capture = process.argv.includes('--captures');
function check(label, command, arguments_, environment = {}) {
  console.log(`\n${label}`);
  const result = spawnSync(command, arguments_, { stdio: 'inherit', env: { ...process.env, ...environment } });
  if (result.status === 0) return true;
  if (result.error) console.error(result.error.message);
  failures.push(label);
  return false;
}

if (check('Clean install', 'npm', ['ci'])) {
  check('TypeScript', 'npm', ['run', 'typecheck']);
  check('Lint', 'npm', ['run', 'lint']);
  check('Tests', 'npm', ['test']);
  const built = check('Production build', 'npm', ['run', 'build']);
  check('Seimsgrend–Bulken regression replay', process.execPath, ['scripts/verify-world.mjs']);
  const r40 = check('Evanger–Voss sources and timetable', process.execPath, ['scripts/verify-r40.mjs']);
  if (r40) check('Evanger–Voss rendered clearance', process.execPath, ['scripts/verify-network-clearance.mjs'], { STATION_DATA_DIR: 'public/data/r40' });
  check('Evanger–Voss dry, wet and snow replays', process.execPath, ['scripts/verify-r40-driving.mjs']);
  if (built) check('R40 graphics workload at 1080p High', 'npm', ['run', 'verify:browser']);
  const network = check('F4, F5 and F6 network geography and autopilot', process.execPath, ['scripts/verify-coverage.mjs']);
  if (network) check('Intercity rendered geometry clearance', process.execPath, ['scripts/verify-network-clearance.mjs']);
  check('R40 rendered geometry clearance', process.execPath, ['scripts/verify-clearance.mjs']);
  if (built && network) check('Offline browser startup for all intercity services', 'npm', ['run', 'verify:network-browser']);
  if (built && capture && check('R40 1080p Ultra gallery', process.execPath, ['scripts/capture-r40.mjs'])) {
    check('Assemble R40 comparisons', process.execPath, ['scripts/assemble-r40-gallery.mjs']);
  }
  check('1080p review captures', process.execPath, ['scripts/verify-evidence.mjs']);
  check('R40 before, paint-over and render evidence', process.execPath, ['scripts/verify-r40-evidence.mjs']);
}
if (failures.length) {
  console.error(`\nVerification failed at ${failures.join(', ')}.`);
  process.exitCode = 1;
} else {
  console.log('\nAutomated verification passed.');
}
