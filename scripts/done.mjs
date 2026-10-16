// One command that says "you can open the PR": runs lint and then the tests, never asks anything.
//   npm run done
// Exit 0 only if both pass. The last line of stdout is fixed and machine-readable:
//   done: ok  |  done: fail lint  |  done: fail test
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EXIT } from './lib/exit.mjs';

export const DONE_LINE = Object.freeze({ ok: 'done: ok', lint: 'done: fail lint', test: 'done: fail test' });
const STEPS = [
  { name: 'lint', fail: EXIT.DONE_LINT_FAILED },
  { name: 'test', fail: EXIT.DONE_TESTS_FAILED },
];

// `run(step)` returns the exit status of that step; stops at the first failure.
export function runDone(run) {
  for (const { name, fail } of STEPS) {
    if (run(name) !== 0) return { code: fail, line: DONE_LINE[name] };
  }
  return { code: EXIT.OK, line: DONE_LINE.ok };
}

// Runs `npm run <step>`; `launch` is injectable so tests can see the real step name and status.
// A step that cannot start (r.error) or ends without a status (killed by a signal) counts as
// failed, never as passed; the reason goes to stderr.
export function npmStep(step, launch = spawnSync) {
  const r = launch('npm', ['run', step], {
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
  });
  if (r.error) console.error(`done: could not run «npm run ${step}»: ${r.error.message}`);
  else if (r.status === null || r.status === undefined) console.error(`done: «npm run ${step}» ended without an exit status (signal: ${r.signal})`);
  return r.error ? 1 : (r.status ?? 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { code, line } = runDone(npmStep);
  console.log(line);
  process.exit(code);
}
