// Builds the Evidence section of a PR body by running the commands, so no number or SHA is typed by hand.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export class EvidenceError extends Error {}

const KEPT_PREFIXES = ['ℹ tests', 'ℹ pass', 'ℹ fail', '✖'];
const DURATION_AT_END = / \(\d+(?:\.\d+)?ms\)$/;
const BASE = 'origin/main';
// The spec reporter is the one that prints the "ℹ tests" lines; Node's default for piped output differs between versions (TAP on 22).
const TEST_ARGS = ['--test', '--test-reporter=spec'];

// Keeps the counter and failure lines of `node --test` and removes the duration at the end of each.
export function filterTestOutput(text) {
  return text
    .split('\n')
    .filter((line) => KEPT_PREFIXES.some((p) => line.startsWith(p)))
    .map((line) => line.replace(DURATION_AT_END, ''))
    .join('\n');
}

function npmCli() {
  const bin = dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath,
    join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const found = candidates.find((c) => c && existsSync(c));
  if (!found) throw new EvidenceError('cannot start npm: npm-cli.js not found next to node');
  return found;
}

// Runs one command with an args array (no shell). Returns { code, output } with stdout then stderr.
// A command that cannot start, or dies by a signal, throws.
export function makeRunner(spawn) {
  return (cmd, args, cwd) => runWith(spawn, cmd, args, cwd);
}

function runWith(spawn, cmd, args, cwd) {
  let file = cmd;
  let fileArgs = args;
  if (cmd === 'node') file = process.execPath;
  if (cmd === 'npm') { file = process.execPath; fileArgs = [npmCli(), ...args]; }
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // a nested `node --test` must act as a runner, not as a test file
  const r = spawn(file, fileArgs, { cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new EvidenceError(`cannot start ${cmd}: ${r.error.message}`, { cause: r.error });
  if (r.status === null) throw new EvidenceError(`${cmd} ended by signal ${r.signal}`);
  return { code: r.status, output: `${r.stdout}${r.stderr}` };
}

export const defaultRunner = makeRunner(spawnSync);

const clean = (text) => text.replace(/\r\n/g, '\n').replace(/\n+$/, '');

function git(runner, cwd, args) {
  const r = runner('git', args, cwd);
  if (r.code !== 0) throw new EvidenceError(`git ${args.join(' ')} failed (exit ${r.code}): ${clean(r.output)}`);
  return clean(r.output);
}

function fenced(command, output, code) {
  const content = `$ ${command}\n${output}\n(exit ${code})`;
  const longestRun = Math.max(0, ...(content.match(/`+/g) ?? []).map((m) => m.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}\n${content}\n${fence}`;
}

function header(head, mergeBase) {
  return [
    '## Evidence',
    '',
    `Produced by \`npm run evidence\`. HEAD ${head}; merge-base with ${BASE} ${mergeBase}.`,
    '',
    `Filter, applied in code: for \`node --test\` (run with \`--test-reporter=spec\`) only lines starting with ${KEPT_PREFIXES.map((p) => `\`${p}\``).join(', ').replace(/, (`✖`)$/, ' and $1')} are kept, and a duration at the end of a kept line, such as \` (12.3ms)\`, is removed so the block is reproducible; every other command is raw. Output is stdout followed by stderr.`,
  ].join('\n');
}

// Returns { markdown, failed }. Throws EvidenceError when the evidence cannot be produced at all.
export function collectEvidence({ cwd, focus, runner = defaultRunner }) {
  if (git(runner, cwd, ['status', '--porcelain']) !== '') {
    throw new EvidenceError('working tree is dirty (git status --porcelain is not empty); commit or remove the changes first');
  }
  const mergeBaseRun = runner('git', ['merge-base', BASE, 'HEAD'], cwd);
  if (mergeBaseRun.code !== 0 || clean(mergeBaseRun.output) === '') {
    throw new EvidenceError(`HEAD has no merge-base with ${BASE}; run: git fetch origin`);
  }
  const short = (rev) => git(runner, cwd, ['rev-parse', '--short', rev]);
  const head = short('HEAD');
  const mergeBase = short(clean(mergeBaseRun.output));

  const steps = [
    { cmd: 'npm', args: ['run', 'lint'] },
    { cmd: 'node', args: TEST_ARGS, filter: true },
    ...focus.map((f) => ({ cmd: 'node', args: [...TEST_ARGS, f], filter: true })),
    { cmd: 'git', args: ['diff', '--shortstat', `${BASE}...HEAD`] },
  ];
  let failed = false;
  const blocks = steps.map(({ cmd, args, filter }) => {
    const r = runner(cmd, args, cwd);
    if (r.code !== 0) failed = true;
    const text = clean(r.output);
    const shown = filter ? filterTestOutput(text) : text;
    if (filter && !shown.split('\n').some((l) => l.startsWith('ℹ tests'))) {
      throw new EvidenceError(`${[cmd, ...args].join(' ')} printed no "ℹ tests" line; its output is not in the spec reporter format`);
    }
    return fenced([cmd, ...args].join(' '), shown, r.code);
  });
  return { markdown: `${header(head, mergeBase)}\n\n${blocks.join('\n\n')}\n`, failed };
}

export function parseArgs(argv) {
  const opts = { focus: [], out: null };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (key !== '--focus' && key !== '--out') throw new EvidenceError(`unknown argument: ${key}`);
    if (argv[i + 1] === undefined) throw new EvidenceError(`${key} needs a value`);
    if (key === '--focus') opts.focus.push(argv[i + 1]);
    else if (opts.out !== null) throw new EvidenceError('repeated argument: --out');
    else opts.out = argv[i + 1];
  }
  return opts;
}
