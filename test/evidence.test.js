// `npm run evidence`: block format, filters, refusals and failure reporting.
// Every test builds its own throwaway git repo in the temp folder; none reads this repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { collectEvidence, filterTestOutput, defaultRunner, parseArgs, EvidenceError } from '../scripts/lib/evidence.mjs';
import { main } from '../scripts/evidence.mjs';
import { prBodyFaults, SECTIONS } from '../scripts/lib/pr-body.mjs';

const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

// A repo whose origin/main is its first commit and whose HEAD is one commit ahead.
function makeRepo({ lint = "console.log('lint-marker')", withOrigin = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'evidence-'));
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fake', scripts: { lint: `node -e "${lint}"` } }));
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  if (withOrigin) git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'change');
  return dir;
}

function addTestFile(dir, name, body) {
  mkdirSync(join(dir, 'test'), { recursive: true });
  writeFileSync(join(dir, 'test', name), `import { test } from 'node:test';\n${body}\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', `add ${name}`);
}

const passing = "test('p', () => {});";
const failing = "test('f', () => { throw new Error('boom'); });";
const commandsIn = (markdown) => [...markdown.matchAll(/^\$ (.*)$/gm)].map((m) => m[1]);

test('block format: header SHAs come from git, one fenced block per command, in order', () => {
  const dir = makeRepo();
  const { markdown, failed } = collectEvidence({ cwd: dir, focus: [] });
  assert.equal(failed, false);
  assert.match(markdown, /^## Evidence\n/);
  assert.ok(markdown.includes(`HEAD ${git(dir, 'rev-parse', '--short', 'HEAD')}`));
  assert.ok(markdown.includes(`merge-base with origin/main ${git(dir, 'rev-parse', '--short', 'origin/main')}`));
  assert.deepEqual(commandsIn(markdown), ['npm run lint', 'node --test', 'git diff --shortstat origin/main...HEAD']);
  assert.equal([...markdown.matchAll(/^\(exit 0\)$/gm)].length, 3);
  assert.ok(markdown.includes('lint-marker'));
  assert.equal([...markdown.matchAll(/^```$/gm)].length, 6);
});

test('focus files get one node --test block each, after the full suite', () => {
  const dir = makeRepo();
  addTestFile(dir, 'one.test.js', passing);
  addTestFile(dir, 'two.test.js', passing);
  const { markdown } = collectEvidence({ cwd: dir, focus: ['test/one.test.js', 'test/two.test.js'] });
  assert.deepEqual(commandsIn(markdown), [
    'npm run lint', 'node --test', 'node --test test/one.test.js', 'node --test test/two.test.js',
    'git diff --shortstat origin/main...HEAD',
  ]);
});

test('header states the filter, and the filter keeps only counters and failure lines', () => {
  const dir = makeRepo();
  const { markdown } = collectEvidence({ cwd: dir, focus: [] });
  assert.match(markdown, /`node --test`.*only lines starting with `ℹ tests`, `ℹ pass`, `ℹ fail` and `✖`/);
  assert.match(markdown, /duration at the end of a kept line/);
  assert.match(markdown, /every other command is raw/);
  const raw = ['✔ ok (1.5ms)', 'ℹ tests 4', 'ℹ suites 0', 'ℹ pass 3', 'ℹ fail 1', 'ℹ duration_ms 99.1', '✖ bad (12.3ms)', 'plain'].join('\n');
  assert.equal(filterTestOutput(raw), ['ℹ tests 4', 'ℹ pass 3', 'ℹ fail 1', '✖ bad'].join('\n'));
});

test('filter: a duration is stripped only at the end of a kept line', () => {
  assert.equal(filterTestOutput('✖ name (3ms) in the middle (4.25ms)'), '✖ name (3ms) in the middle');
  assert.equal(filterTestOutput('✖ name (no unit)'), '✖ name (no unit)');
});

test('the same state gives the same block twice', () => {
  const dir = makeRepo();
  addTestFile(dir, 'one.test.js', passing);
  const a = collectEvidence({ cwd: dir, focus: ['test/one.test.js'] }).markdown;
  const b = collectEvidence({ cwd: dir, focus: ['test/one.test.js'] }).markdown;
  assert.equal(a, b);
});

test('dirty tree is refused, tracked or untracked; a clean tree is accepted', () => {
  const dir = makeRepo();
  writeFileSync(join(dir, 'untracked.txt'), 'x');
  assert.throws(() => collectEvidence({ cwd: dir, focus: [] }), (e) => e instanceof EvidenceError && /working tree is dirty/.test(e.message));
  git(dir, 'add', '.');
  assert.throws(() => collectEvidence({ cwd: dir, focus: [] }), /working tree is dirty/);
  git(dir, 'commit', '-q', '-m', 'clean');
  assert.doesNotThrow(() => collectEvidence({ cwd: dir, focus: [] }));
});

test('no origin/main is refused and tells the user to fetch', () => {
  const dir = makeRepo({ withOrigin: false });
  assert.throws(() => collectEvidence({ cwd: dir, focus: [] }), (e) => e instanceof EvidenceError && /git fetch origin/.test(e.message));
});

test('a non-zero command is reported with its exit code and the tool fails at the end', () => {
  const dir = makeRepo({ lint: "console.log('lint-bad');process.exit(3)" });
  const { markdown, failed } = collectEvidence({ cwd: dir, focus: [] });
  assert.equal(failed, true);
  assert.ok(markdown.includes('lint-bad'));
  assert.equal([...markdown.matchAll(/^\(exit 3\)$/gm)].length, 1);
  assert.ok(markdown.includes('$ git diff --shortstat origin/main...HEAD'), 'later commands still run');
});

test('a failing focus file shows the failure line and the counters', () => {
  const dir = makeRepo();
  addTestFile(dir, 'bad.test.js', failing);
  const { markdown, failed } = collectEvidence({ cwd: dir, focus: ['test/bad.test.js'] });
  assert.equal(failed, true);
  assert.match(markdown, /^✖ f$/m);
  assert.match(markdown, /^ℹ fail 1$/m);
});

test('a command that cannot start is an error, not a block', () => {
  const dir = makeRepo();
  assert.throws(() => defaultRunner('no-such-command-xyz', [], dir), (e) => e instanceof EvidenceError && /cannot start/.test(e.message));
  const runner = (cmd, args, cwd) => {
    if (cmd === 'node') throw new EvidenceError('cannot start: node');
    return defaultRunner(cmd, args, cwd);
  };
  assert.throws(() => collectEvidence({ cwd: dir, focus: [], runner }), /cannot start: node/);
});

test('the diff uses three dots, never two', () => {
  const dir = makeRepo();
  const seen = [];
  const runner = (cmd, args, cwd) => { seen.push([cmd, ...args].join(' ')); return defaultRunner(cmd, args, cwd); };
  collectEvidence({ cwd: dir, focus: [], runner });
  assert.deepEqual(seen.filter((c) => c.startsWith('git diff')), ['git diff --shortstat origin/main...HEAD']);
});

test('the runner is injectable: a fake runner replaces lint and the suite', () => {
  const dir = makeRepo();
  const seen = [];
  const runner = (cmd, args, cwd) => {
    if (cmd === 'git') return defaultRunner(cmd, args, cwd);
    seen.push([cmd, ...args].join(' '));
    return { code: 0, output: 'FAKE' };
  };
  const { markdown } = collectEvidence({ cwd: dir, focus: [], runner });
  assert.deepEqual(seen, ['npm run lint', 'node --test']);
  assert.ok(markdown.includes('FAKE'));
});

test('output containing a code fence cannot close the block early', () => {
  const dir = makeRepo({ lint: "console.log('```')" });
  const { markdown } = collectEvidence({ cwd: dir, focus: [] });
  assert.ok(markdown.includes('````\n$ npm run lint'));
});

test('arguments: --focus repeats, --out takes one value, anything else is an error', () => {
  assert.deepEqual(parseArgs(['--focus', 'a', '--focus', 'b', '--out', 'o.md']), { focus: ['a', 'b'], out: 'o.md' });
  assert.deepEqual(parseArgs([]), { focus: [], out: null });
  assert.throws(() => parseArgs(['--focus']), /needs a value/);
  assert.throws(() => parseArgs(['--out', 'a', '--out', 'b']), /repeated/);
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
});

test('main: prints to stdout by default and exits 0', () => {
  const dir = makeRepo();
  const out = []; const err = [];
  const code = main([], { cwd: dir, write: (s) => out.push(s), err: (s) => err.push(s) });
  assert.equal(code, 0);
  assert.deepEqual(err, []);
  assert.match(out.join(''), /^## Evidence\n/);
});

test('main: --out writes the file and prints nothing to stdout', () => {
  const dir = makeRepo();
  const outPath = join(tmpdir(), `evidence-out-${process.pid}-${Date.now()}.md`);
  const out = [];
  const code = main(['--out', outPath], { cwd: dir, write: (s) => out.push(s), err: () => {} });
  assert.equal(code, 0);
  assert.deepEqual(out, []);
  assert.match(readFileSync(outPath, 'utf8'), /^## Evidence\n/);
});

test('main: a failing command exits 1 but the block is still written', () => {
  const dir = makeRepo({ lint: 'process.exit(2)' });
  const out = []; const err = [];
  const code = main([], { cwd: dir, write: (s) => out.push(s), err: (s) => err.push(s) });
  assert.equal(code, 1);
  assert.match(out.join(''), /\(exit 2\)/);
  assert.match(err.join(''), /evidence: a command failed/);
});

test('main: refusals exit 1 with a message on stderr and write nothing', () => {
  const dir = makeRepo();
  writeFileSync(join(dir, 'dirty.txt'), 'x');
  const out = []; const err = [];
  const code = main([], { cwd: dir, write: (s) => out.push(s), err: (s) => err.push(s) });
  assert.equal(code, 1);
  assert.match(err.join(''), /evidence: working tree is dirty/);
  assert.deepEqual(out, []);
  assert.equal(main(['--bad'], { cwd: dir, write: () => {}, err: (s) => err.push(s) }), 1);
});

test('the generated section passes the PR body check inside a full body', () => {
  const dir = makeRepo();
  const { markdown } = collectEvidence({ cwd: dir, focus: [] });
  const body = ['## What changes', 'x', markdown, '## Red before', 'x', '## Not verified', 'Nothing'].join('\n\n');
  assert.deepEqual(prBodyFaults(body, ['test/evidence.test.js']), []);
});

test('the PR template tells the author that Evidence is the output of npm run evidence', () => {
  const template = readFileSync(new URL('../.github/pull_request_template.md', import.meta.url), 'utf8');
  const evidence = SECTIONS.find((s) => s.name === 'Evidence');
  assert.ok(evidence.hint.includes('`npm run evidence`'));
  assert.ok(template.includes(evidence.hint));
});
