// One command that says "you can open the PR": runs lint and then the tests, never asks anything.
//   npm run done
// Exit 0 only if both pass. The last line of stdout is fixed and machine-readable (DONE_LINE below).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EXIT, ExitError, finish } from './lib/exit.mjs';
import { liberarAlTerminar, tomarTurno, umbralDeEntorno } from './lib/turno.mjs';

export const DONE_LINE = Object.freeze({ ok: 'done: ok', lint: 'done: fail lint', test: 'done: fail test', turn: 'done: fail turn' });
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
export function npmStep(step, launch = spawnSync, platform = process.platform) {
  const r = launch('npm', ['run', step], {
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: platform === 'win32', // npm is npm.cmd on Windows: it only starts through a shell
  });
  if (r.error) console.error(`done: could not run «npm run ${step}»: ${r.error.message}`);
  else if (r.status === null || r.status === undefined) console.error(`done: «npm run ${step}» ended without an exit status (signal: ${r.signal})`);
  return r.error ? 1 : (r.status ?? 1);
}

// Returns what the command prints and its exit code; the block below only prints and exits.
// `turno` (scripts/lib/turno.mjs) waits for the turn and for free memory and returns the handle that gives it back; when the
// wait runs out nothing runs. The real command always passes it; only the tests that fake the steps leave it out.
export function cliDone(run = npmStep, turno = null) {
  let handle = null;
  if (turno) {
    try { handle = turno(); } catch (e) {
      if (!(e instanceof ExitError)) throw e;
      return { code: e.exit, stdout: `${DONE_LINE.turn}\n`, stderr: `${e.message}\n` };
    }
  }
  try {
    const { code, line } = runDone(run);
    return { code, stdout: `${line}\n`, stderr: '' };
  } finally { handle?.soltar(); }
}

// The real turn: it is given back on any end, including a signal.
export function turnoReal(env = process.env, opciones = {}, proc = process) {
  const handle = tomarTurno({ minLibre: umbralDeEntorno(env), ...opciones });
  liberarAlTerminar(handle, proc);
  return handle;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) finish(cliDone(npmStep, turnoReal));
