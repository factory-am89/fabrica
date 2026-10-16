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

// A step that cannot even start counts as failed (status null), never as passed.
const npm = (step) => {
  const r = spawnSync('npm', ['run', step === 'test' ? 'test' : 'lint'], {
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
  });
  return r.status ?? 1;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { code, line } = runDone(npm);
  console.log(line);
  process.exit(code);
}
