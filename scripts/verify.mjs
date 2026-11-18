import { spawnSync } from 'node:child_process';

const failures = [];
function check(label, command, arguments_) {
  console.log(`\n${label}`);
  const result = spawnSync(command, arguments_, { stdio: 'inherit', env: process.env });
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
  check('R40 geography and autopilot', process.execPath, ['scripts/verify-world.mjs']);
  const network = check('F4, F5 and F6 network geography and autopilot', process.execPath, ['scripts/verify-coverage.mjs']);
  if (network) check('Intercity rendered geometry clearance', process.execPath, ['scripts/verify-network-clearance.mjs']);
  check('R40 rendered geometry clearance', process.execPath, ['scripts/verify-clearance.mjs']);
  if (built) check('R40 1080p browser frame timing', 'npm', ['run', 'verify:browser']);
}
if (failures.length) {
  console.error(`\nVerification failed at ${failures.join(', ')}.`);
  process.exitCode = 1;
} else {
  console.log('\nAutomated verification passed.');
}
