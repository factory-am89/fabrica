// `npm run evidence`: block format, filters, refusals and failure reporting.
// Almost every test uses a scripted fake runner (no process, no git, no npm). Real tools appear only in
// the cannot-start and stdout/stderr checks (real node, no repo) and in the single end-to-end test at the end
// (real git, npm and node in a throwaway repo). Every temp folder is removed by t.after; the throwaway
// repo has no node_modules, so no junction is ever followed by the recursive delete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { collectEvidence, filterTestOutput, defaultRunner, makeRunner, parseArgs, EvidenceError } from '../scripts/lib/evidence.mjs';
import { main } from '../scripts/evidence.mjs';
import { prBodyFaults, SECTIONS } from '../scripts/lib/pr-body.mjs';

const SPEC = ['✔ a (1.5ms)', 'ℹ tests 3', 'ℹ suites 0', 'ℹ pass 3', 'ℹ fail 0', 'ℹ duration_ms 99.1'].join('\n');
const MERGE_BASE = 'b'.repeat(40);
const commandsIn = (markdown) => [...markdown.matchAll(/^\$ (.*)$/gm)].map((m) => m[1]);

function defaults(key) {
  if (key === 'git status --porcelain') return '';
  if (key === 'git merge-base origin/main HEAD') return `${MERGE_BASE}\n`;
  if (key === 'git rev-parse --short HEAD') return 'aaaaaaa\n';
  if (key === `git rev-parse --short ${MERGE_BASE}`) return 'bbbbbbb\n';
  if (key === 'npm run lint') return '> lint\n> eslint .\n';
  if (key.startsWith('npm test -- --test-reporter=spec')) return SPEC;
  if (key === 'git diff --shortstat origin/main...HEAD') return ' 1 file changed, 1 insertion(+)\n';
  return undefined;
}

// Scripted runner: answers by the command line; an unknown command is a test error. Records every call.
function fakeRunner(overrides = {}) {
  const calls = [];
  const runner = (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    calls.push(key);
    const answer = key in overrides ? overrides[key] : defaults(key);
    if (answer === undefined) throw new Error(`fake runner: unexpected command: ${key}`);
    if (answer instanceof Error) throw answer;
    return { code: 0, ...(typeof answer === 'string' ? { output: answer } : answer) };
  };
  runner.calls = calls;
  return runner;
}

const collect = (runner, focus = []) => collectEvidence({ cwd: '/unused', focus, runner });

test('block format: header SHAs come from git, one fenced block per command, in order', () => {
  const { markdown, failed } = collect(fakeRunner());
  assert.equal(failed, false);
  assert.match(markdown, /^## Evidence\n/);
  assert.ok(markdown.includes('HEAD aaaaaaa; merge-base with origin/main bbbbbbb.'));
  assert.deepEqual(commandsIn(markdown), [
    'npm run lint', 'npm test -- --test-reporter=spec', 'git diff --shortstat origin/main...HEAD',
  ]);
  assert.equal([...markdown.matchAll(/^\(exit 0\)$/gm)].length, 3);
  assert.equal([...markdown.matchAll(/^```$/gm)].length, 6);
  assert.ok(markdown.includes('> eslint .'));
});

test('focus files get one npm test block each, after the full suite', () => {
  const { markdown } = collect(fakeRunner(), ['test/one.test.js', 'test/two.test.js']);
  assert.deepEqual(commandsIn(markdown), [
    'npm run lint', 'npm test -- --test-reporter=spec',
    'npm test -- --test-reporter=spec test/one.test.js', 'npm test -- --test-reporter=spec test/two.test.js',
    'git diff --shortstat origin/main...HEAD',
  ]);
});

test('the tests go through npm test (package.json options) with the spec reporter pinned on every run', () => {
  const runner = fakeRunner();
  collect(runner, ['test/one.test.js']);
  const testCalls = runner.calls.filter((c) => c.startsWith('npm test'));
  assert.equal(testCalls.length, 2);
  for (const c of testCalls) assert.match(c, /^npm test -- --test-reporter=spec( |$)/);
});

test('header states the filter, and the filter keeps only counters and failure lines', () => {
  const { markdown } = collect(fakeRunner());
  assert.match(markdown, /`node --test`.*only lines starting with `ℹ tests`, `ℹ pass`, `ℹ fail` and `✖`/);
  assert.match(markdown, /duration at the end of a kept line/);
  assert.match(markdown, /every other command is raw/);
  const raw = ['✔ ok (1.5ms)', 'ℹ tests 4', 'ℹ suites 0', 'ℹ pass 3', 'ℹ fail 1', 'ℹ duration_ms 99.1', '✖ bad (12.3ms)', 'plain'].join('\n');
  assert.equal(filterTestOutput(raw), ['ℹ tests 4', 'ℹ pass 3', 'ℹ fail 1', '✖ bad'].join('\n'));
  assert.ok(!markdown.includes('duration_ms'));
  assert.ok(!markdown.includes('1.5ms'));
});

test('filter: a duration is stripped only at the end of a kept line', () => {
  assert.equal(filterTestOutput('✖ name (3ms) in the middle (4.25ms)'), '✖ name (3ms) in the middle');
  assert.equal(filterTestOutput('✖ name (no unit)'), '✖ name (no unit)');
});

test('the same answers give the same block twice', () => {
  assert.equal(collect(fakeRunner()).markdown, collect(fakeRunner()).markdown);
});

test('a dirty tree is refused before any command runs; a clean one is accepted', () => {
  const dirty = fakeRunner({ 'git status --porcelain': ' M a.txt\n?? b.txt\n' });
  assert.throws(() => collect(dirty), (e) => e instanceof EvidenceError && /working tree is dirty/.test(e.message));
  assert.deepEqual(dirty.calls, ['git status --porcelain']);
  assert.doesNotThrow(() => collect(fakeRunner()));
});

test('no merge-base is refused and tells the user to fetch', () => {
  const failing = fakeRunner({ 'git merge-base origin/main HEAD': { code: 1, output: '' } });
  assert.throws(() => collect(failing), (e) => e instanceof EvidenceError && /git fetch origin/.test(e.message));
  const empty = fakeRunner({ 'git merge-base origin/main HEAD': '' });
  assert.throws(() => collect(empty), /git fetch origin/);
});

test('a non-zero command is reported with its exit code, later commands still run, and failed is set', () => {
  const runner = fakeRunner({ 'npm run lint': { code: 3, output: 'lint-bad\n' } });
  const { markdown, failed } = collect(runner);
  assert.equal(failed, true);
  assert.ok(markdown.includes('lint-bad'));
  assert.equal([...markdown.matchAll(/^\(exit 3\)$/gm)].length, 1);
  assert.ok(markdown.includes('$ git diff --shortstat origin/main...HEAD'));
});

test('a failing focus file shows the failure line and the counters', () => {
  const key = 'npm test -- --test-reporter=spec test/bad.test.js';
  const runner = fakeRunner({ [key]: { code: 1, output: '✖ f (2.5ms)\nℹ tests 1\nℹ pass 0\nℹ fail 1\n✖ failing tests:\n' } });
  const { markdown, failed } = collect(runner, ['test/bad.test.js']);
  assert.equal(failed, true);
  assert.match(markdown, /^✖ f$/m);
  assert.match(markdown, /^ℹ fail 1$/m);
  assert.match(markdown, /^\(exit 1\)$/m);
});

test('node --test output without an "ℹ tests" line (TAP, empty) is an error, not an empty block', () => {
  const tap = 'TAP version 13\n# Subtest: x\nok 1 - x\n1..1\n# tests 1\n# pass 1\n# fail 0\n';
  assert.throws(() => collect(fakeRunner({ 'npm test -- --test-reporter=spec': tap })), (e) => e instanceof EvidenceError && /no "ℹ tests" line/.test(e.message));
  assert.throws(() => collect(fakeRunner({ 'npm test -- --test-reporter=spec': '' })), /no "ℹ tests" line/);
  const focusTap = fakeRunner({ 'npm test -- --test-reporter=spec test/a.test.js': tap });
  assert.throws(() => collect(focusTap, ['test/a.test.js']), /test\/a\.test\.js printed no "ℹ tests" line/);
  assert.doesNotThrow(() => collect(fakeRunner({ 'npm test -- --test-reporter=spec': SPEC })));
});

test('a command that cannot start is an error, not a block', () => {
  assert.throws(() => defaultRunner('no-such-command-xyz', [], tmpdir()), (e) => e instanceof EvidenceError && /cannot start/.test(e.message));
  const runner = fakeRunner({ 'npm run lint': new EvidenceError('cannot start: npm') });
  assert.throws(() => collect(runner), /cannot start: npm/);
});

test('a command that dies by a signal throws instead of returning an exit code', () => {
  const runner = makeRunner(() => ({ status: null, signal: 'SIGKILL', stdout: '', stderr: '' }));
  assert.throws(() => runner('git', ['status'], '/unused'), (e) => e instanceof EvidenceError && /ended by signal SIGKILL/.test(e.message));
});

test('the runner returns stdout followed by stderr, as the header promises', () => {
  const runner = makeRunner(() => ({ status: 0, signal: null, stdout: 'OUT-LINE\n', stderr: 'ERR-LINE\n' }));
  assert.deepEqual(runner('git', ['status'], '/unused'), { code: 0, output: 'OUT-LINE\nERR-LINE\n' });
  assert.match(collect(fakeRunner()).markdown, /Output is stdout followed by stderr\./);
  const real = defaultRunner('node', ['-e', "process.stderr.write('E1\\n');process.stdout.write('O1\\n')"], tmpdir());
  assert.deepEqual(real, { code: 0, output: 'O1\nE1\n' });
});

test('commands are spawned with an args array and no shell', () => {
  const seen = [];
  const runner = makeRunner((file, args, options) => { seen.push({ args, shell: options.shell }); return { status: 0, signal: null, stdout: '', stderr: '' }; });
  runner('git', ['diff', '--shortstat', 'a b'], '/unused');
  assert.deepEqual(seen, [{ args: ['diff', '--shortstat', 'a b'], shell: undefined }]);
});

test('the diff uses three dots, never two', () => {
  const runner = fakeRunner();
  collect(runner);
  assert.deepEqual(runner.calls.filter((c) => c.startsWith('git diff')), ['git diff --shortstat origin/main...HEAD']);
});

test('output containing a code fence cannot close the block early', () => {
  const { markdown } = collect(fakeRunner({ 'npm run lint': '```\n' }));
  assert.ok(markdown.includes('````\n$ npm run lint'));
});

test('arguments: --focus repeats, --out takes one value, anything else is an error', () => {
  assert.deepEqual(parseArgs(['--focus', 'a', '--focus', 'b', '--out', 'o.md']), { focus: ['a', 'b'], out: 'o.md' });
  assert.deepEqual(parseArgs([]), { focus: [], out: null });
  assert.throws(() => parseArgs(['--focus']), /needs a value/);
  assert.throws(() => parseArgs(['--out', 'a', '--out', 'b']), /repeated/);
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
});

function mainWith(argv, runner) {
  const out = []; const err = [];
  const code = main(argv, { cwd: '/unused', write: (s) => out.push(s), err: (s) => err.push(s), runner });
  return { code, out: out.join(''), err: err.join('') };
}

test('main: prints to stdout by default and exits 0', () => {
  const r = mainWith([], fakeRunner());
  assert.equal(r.code, 0);
  assert.equal(r.err, '');
  assert.match(r.out, /^## Evidence\n/);
});

test('main: --out writes the file and prints nothing to stdout', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'evidence-out-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'out.md');
  const r = mainWith(['--out', file], fakeRunner());
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
  assert.match(readFileSync(file, 'utf8'), /^## Evidence\n/);
});

test('main: a failing command exits 1 but the block is still written', () => {
  const r = mainWith([], fakeRunner({ 'npm run lint': { code: 2, output: 'x' } }));
  assert.equal(r.code, 1);
  assert.match(r.out, /\(exit 2\)/);
  assert.match(r.err, /evidence: a command failed/);
});

test('main: refusals exit 1 with a message on stderr and write nothing', () => {
  const r = mainWith([], fakeRunner({ 'git status --porcelain': ' M x\n' }));
  assert.equal(r.code, 1);
  assert.match(r.err, /evidence: working tree is dirty/);
  assert.equal(r.out, '');
  const bad = mainWith(['--bad'], fakeRunner());
  assert.equal(bad.code, 1);
  assert.match(bad.err, /unknown argument/);
});

test('the generated section passes the PR body check inside a full body', () => {
  const { markdown } = collect(fakeRunner());
  const body = ['## What changes', 'x', markdown, '## Red before', 'x', '## Decisions', 'None', '## Not verified', 'Nothing'].join('\n\n');
  assert.deepEqual(prBodyFaults(body, ['test/evidence.test.js']), []);
});

test('the PR template tells the author that Evidence is the output of npm run evidence', () => {
  const template = readFileSync(new URL('../.github/pull_request_template.md', import.meta.url), 'utf8');
  const evidence = SECTIONS.find((s) => s.name === 'Evidence');
  assert.ok(evidence.hint.includes('`npm run evidence`'));
  assert.ok(template.includes(evidence.hint));
});

// The only end-to-end test: real git, real npm, real node, in a throwaway repo.
test('end to end: a real repo with a real lint script and a real test file', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'evidence-e2e-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  // The test script carries a cap like the real one: the suite runs through it, and the reporter still reaches node.
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fake', scripts: { lint: 'node -e "console.log(\'lint-marker\')"', test: 'node --test --test-concurrency=1' } }));
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  mkdirSync(join(dir, 'test'));
  writeFileSync(join(dir, 'test', 'one.test.js'), "import { test } from 'node:test';\ntest('p', () => {});\n");
  git('add', '.');
  git('commit', '-q', '-m', 'change');
  const { markdown, failed } = collectEvidence({ cwd: dir, focus: ['test/one.test.js'] });
  assert.equal(failed, false);
  assert.ok(markdown.includes(`HEAD ${git('rev-parse', '--short', 'HEAD')};`));
  assert.ok(markdown.includes(`merge-base with origin/main ${git('rev-parse', '--short', 'origin/main')}.`));
  assert.ok(markdown.includes('lint-marker'));
  assert.equal([...markdown.matchAll(/^ℹ tests 1$/gm)].length, 2);
  assert.equal([...markdown.matchAll(/^\(exit 0\)$/gm)].length, 4);
  assert.match(markdown, /^ 1 file changed/m);
  writeFileSync(join(dir, 'dirty.txt'), 'x');
  assert.throws(() => collectEvidence({ cwd: dir, focus: [] }), /working tree is dirty/);
});
