// Machine canaries: each known escape is run through the real entry point with its default lists (no list
// flags), as CI runs it, and must be caught. Each canary has a green control through the same entry point,
// so a canary cannot go red for another reason. Prints «machine canaries: caught/total»; fails on any miss.
// Also the meta-test: every code of every *_FAULTS export in scripts/lib appears in another test file.
// No network, git or clock; temporaries live in one own, unique folder that is removed at the end.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cargarPreguntas, decidir } from '../scripts/veredicto.mjs';

const HERE = import.meta.dirname;
const ROOT = path.join(HERE, '..');
const read = (...p) => readFileSync(path.join(HERE, ...p), 'utf8');
const machine = (f) => read('fixtures', 'golden', 'machine', f);
const PLAN_OK = read('fixtures', 'plans', 'good.md');
const COMPARE_HEAD = read('fixtures', 'pr-body', 'compare-head.json');

const work = mkdtempSync(path.join(tmpdir(), 'golden-machine-'));
after(() => rmSync(work, { recursive: true, force: true }));
let seq = 0;

// Runs a script from a fresh folder holding `files`. Callers never pass a list flag.
function run(script, args, files) {
  const dir = path.join(work, `run${seq++}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { cwd: dir, env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const checkPlan = (args, files) => run('check-plan.mjs', args, files);
const prBody = (args, files) => run('pr-body.mjs', args, files);

const compare = (files) => JSON.stringify({ files });
const renamedIntoPlans = compare([{ filename: 'plans/x.md', status: 'renamed', previous_filename: 'scripts/veredicto.mjs' }]);
const addedPlan = compare([{ filename: 'plans/x.md', status: 'added' }]);

const reviewerIds = () => cargarPreguntas('standards/code.md').filter((q) => q.quien === 'revisor').map((q) => q.id);
function judge(ids) {
  const respuestas = ids.map((id) => ({ id, respuesta: 'sí', prueba: 'x' }));
  return decidir(JSON.stringify({ respuestas }), cargarPreguntas('standards/code.md'), { sha: 'a', cabeza: 'a' });
}

// caught(): true if the escape was stopped for the expected reason. control(): the same entry point with a
// good input must pass, so the canary is red for its own reason.
const CANARIES = [
  {
    name: 'a file renamed into plans/ (check-plan --compare-file)',
    caught: () => {
      const r = checkPlan(['--compare-file', 'c.json'], { 'c.json': renamedIntoPlans });
      return r.code === 1 && /PR_PREVIOUS_OUTSIDE/.test(r.err);
    },
    control: () => checkPlan(['--compare-file', 'c.json'], { 'c.json': addedPlan, 'plans/x.md': PLAN_OK }).code === 0,
  },
  {
    name: 'a dependency cycle (check-plan --file)',
    caught: () => {
      const r = checkPlan(['--file', 'p.md'], { 'p.md': machine('plan-cycle.md') });
      return r.code === 1 && /DEPENDENCY_CYCLE/.test(r.err);
    },
    control: () => checkPlan(['--file', 'p.md'], { 'p.md': PLAN_OK }).code === 0,
  },
  {
    name: 'a chunk touching apps/ with no decision (check-plan --file)',
    caught: () => {
      const r = checkPlan(['--file', 'p.md'], { 'p.md': machine('plan-touches-apps.md') });
      return r.code === 1 && /CLOSED_WITHOUT_DECISION/.test(r.err);
    },
    control: () => checkPlan(['--file', 'p.md'], { 'p.md': PLAN_OK }).code === 0,
  },
  {
    name: 'an Evidence block from another commit (pr-body --compare-file)',
    caught: () => {
      const r = prBody(['--body-file', 'b.md', '--compare-file', 'c.json'], { 'b.md': read('fixtures', 'pr-body', 'stale-head.md'), 'c.json': COMPARE_HEAD });
      return r.code === 1 && /not for the PR head/.test(r.err);
    },
    control: () => prBody(['--body-file', 'b.md', '--compare-file', 'c.json'], { 'b.md': read('fixtures', 'pr-body', 'good.md'), 'c.json': COMPARE_HEAD }).code === 0,
  },
  {
    name: 'answers with P ids to the judge, with the real standards/code.md (decidir)',
    caught: () => {
      const v = judge(reviewerIds().map((id) => id.replace(/^C/, 'P')));
      return v.ok === false && v.fallos.some((f) => /ids desconocidos/.test(f));
    },
    control: () => judge(reviewerIds()).ok === true,
  },
];

test('machine canaries: every known escape is caught by the real command with its default lists', () => {
  const notRed = CANARIES.filter((c) => !c.control()).map((c) => c.name);
  assert.deepEqual(notRed, [], 'the green control of these canaries did not pass, so the canary proves nothing');
  const missed = CANARIES.filter((c) => !c.caught()).map((c) => c.name);
  const caught = CANARIES.length - missed.length;
  console.log(`machine canaries: ${caught}/${CANARIES.length}`);
  assert.deepEqual(missed, [], `machine canaries: ${caught}/${CANARIES.length}; missed`);
});

test('the canaries pass no list flag: the real closed list and gate files decide', () => {
  const src = readFileSync(path.join(HERE, 'golden-machine.test.js'), 'utf8');
  assert.equal(/['"]--(closed-paths|gate-files|files-file)['"]/.test(src), false);
});

// Meta-test: a new check brings a bad case. Textual (a comment could fool it; the reviewer's C6 stays the judge).
const LIB = path.join(ROOT, 'scripts', 'lib');
const OTHER_TESTS = readdirSync(HERE).filter((f) => f.endsWith('.js') && f !== 'golden-machine.test.js').map((f) => [f, read(f)]);

async function faultExports() {
  const found = [];
  for (const f of readdirSync(LIB).filter((n) => n.endsWith('.mjs'))) {
    const mod = await import(pathToFileURL(path.join(LIB, f)).href);
    for (const [name, value] of Object.entries(mod)) {
      if (/_FAULTS$/.test(name)) found.push({ file: f, name, codes: Object.values(value) });
    }
  }
  return found;
}

test('every code of every *_FAULTS export has a bad case in some other test file', async () => {
  const exports = await faultExports();
  assert.ok(exports.length >= 2, `expected at least PLAN_FAULTS and PLAN_PR_FAULTS, found ${exports.length}`);
  const without = [];
  for (const e of exports) {
    assert.ok(e.codes.length > 0, `${e.name} has no codes`);
    for (const code of e.codes) {
      if (!OTHER_TESTS.some(([, text]) => new RegExp(`\\b${code}\\b`).test(text))) without.push(`${e.file}: ${e.name}.${code}`);
    }
  }
  assert.deepEqual(without, [], 'codes with no bad case in any test file');
});
