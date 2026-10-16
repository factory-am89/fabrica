// The plan PR check: planPrFaults (pure) and the --compare-file mode of scripts/check-plan.mjs.
// Deterministic: literal fixtures and a temp folder only; no network, git or clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { planPrFaults, PLAN_PR_FAULTS } from '../scripts/lib/plan.mjs';
import { COMPARE_LIMIT } from '../scripts/lib/pr-body.mjs';

const HERE = import.meta.dirname;
const CLI = path.join(HERE, '..', 'scripts', 'check-plan.mjs');
const GOOD = readFileSync(path.join(HERE, 'fixtures', 'plans', 'good.md'), 'utf8');
const BAD = readFileSync(path.join(HERE, 'fixtures', 'plans', 'no-not-done.md'), 'utf8');

const plan = (filename = 'plans/x.md', status = 'added', extra = {}) => ({ filename, status, ...extra });
const codes = (files) => planPrFaults(files).map((f) => f.code);
const C = PLAN_PR_FAULTS;

test('planPrFaults: a PR with no file under plans/ is not a plan PR', () => {
  assert.deepEqual(planPrFaults([]), []);
  assert.deepEqual(planPrFaults([{ filename: 'scripts/a.mjs', status: 'modified' }]), []);
});

test('planPrFaults: exactly one plans/<slug>.md, added or modified, passes', () => {
  assert.deepEqual(planPrFaults([plan('plans/x.md', 'added')]), []);
  assert.deepEqual(planPrFaults([plan('plans/my-plan-2.md', 'modified')]), []);
});

test('planPrFaults: each way of not being exactly one plan is a fault', () => {
  assert.deepEqual(codes([plan('plans/a.md'), plan('plans/b.md')]), [C.PR_NOT_ONE_PLAN]);
  assert.deepEqual(codes([plan(), { filename: 'scripts/a.mjs', status: 'modified' }]), [C.PR_OUTSIDE_PLANS]);
  assert.deepEqual(codes([plan('plans/X.md')]), [C.PR_BAD_PLAN_NAME]);
  assert.deepEqual(codes([plan('plans/a/b.md')]), [C.PR_BAD_PLAN_NAME]);
  assert.deepEqual(codes([plan('plans/x.txt')]), [C.PR_BAD_PLAN_NAME]);
});

test('planPrFaults: renamed, copied and removed are faults', () => {
  assert.deepEqual(codes([plan('plans/x.md', 'renamed', { previous_filename: 'plans/y.md' })]), [C.PR_BAD_STATUS]);
  assert.deepEqual(codes([plan('plans/x.md', 'copied')]), [C.PR_BAD_STATUS]);
  assert.deepEqual(codes([plan('plans/x.md', 'removed')]), [C.PR_BAD_STATUS]);
  assert.deepEqual(codes([{ filename: 'plans/x.md' }]), [C.PR_BAD_STATUS]);
});

test('planPrFaults: a rename from outside plans/ cannot pass a diff off as a plan', () => {
  const smuggled = plan('plans/x.md', 'renamed', { previous_filename: 'scripts/veredicto.mjs' });
  assert.deepEqual(codes([smuggled]), [C.PR_BAD_STATUS, C.PR_PREVIOUS_OUTSIDE]);
  assert.deepEqual(codes([plan('plans/x.md', 'added', { previous_filename: 'scripts/veredicto.mjs' })]), [C.PR_PREVIOUS_OUTSIDE]);
});

test('planPrFaults: moving a plan out of plans/ is a fault too', () => {
  const moved = { filename: 'docs/x.md', status: 'renamed', previous_filename: 'plans/x.md' };
  assert.ok(codes([moved]).length > 0);
});

test('planPrFaults: a truncated list is a fault, at the same limit as pr-body', () => {
  assert.equal(COMPARE_LIMIT, 300);
  const files = (n) => Array.from({ length: n }, (_, i) => ({ filename: `a${i}.js`, status: 'added' }));
  assert.deepEqual(codes(files(COMPARE_LIMIT)), [C.PR_TRUNCATED]);
  assert.equal(codes([plan(), ...files(COMPARE_LIMIT - 2)]).includes(C.PR_TRUNCATED), false);
  assert.deepEqual(codes(files(COMPARE_LIMIT - 1)), []);
});

test('the truncation limit lives in one place: plan.mjs and pr-body.mjs import it, neither writes the number', () => {
  const lib = path.join(HERE, '..', 'scripts', 'lib');
  const src = readFileSync(path.join(lib, 'plan.mjs'), 'utf8');
  assert.match(src, /import \{ COMPARE_LIMIT \} from '\.\/pr-body\.mjs'/);
  assert.doesNotMatch(src, /\b300\b/);
  assert.doesNotMatch(readFileSync(path.join(HERE, '..', 'scripts', 'pr-body.mjs'), 'utf8'), /\b300\b/);
});

test('planPrFaults: files that is not an array throws', () => {
  for (const bad of [undefined, null, {}, 'plans/x.md']) assert.throws(() => planPrFaults(bad), TypeError);
});

function cli(compare, { planText, name = 'plans/x.md', extra = [] } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plan-check-ci-'));
  try {
    if (planText !== undefined) {
      mkdirSync(path.join(dir, path.dirname(name)), { recursive: true });
      writeFileSync(path.join(dir, name), planText);
    }
    writeFileSync(path.join(dir, 'compare.json'), typeof compare === 'string' ? compare : JSON.stringify(compare));
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, [CLI, '--compare-file', 'compare.json', ...extra], { cwd: dir, env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout, err: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('check-plan --compare-file: a good plan in a good compare exits 0', () => {
  const r = cli({ files: [plan()] }, { planText: GOOD });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^check-plan: ok/);
});

test('check-plan --compare-file: a bad plan exits 1 with its fault', () => {
  const r = cli({ files: [plan()] }, { planText: BAD });
  assert.equal(r.code, 1);
  assert.match(r.err, /MISSING_FIELD .*Not done/);
});

test('check-plan --compare-file: a compare without plan files is not a plan PR and exits 0', () => {
  const r = cli({ files: [{ filename: 'scripts/a.mjs', status: 'modified' }] });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /not a plan PR/);
});

test('check-plan --compare-file: a PR-shape fault stops before the plan is read', () => {
  const r = cli({ files: [plan('plans/a.md'), plan('plans/b.md')] });
  assert.equal(r.code, 1);
  assert.match(r.err, /PR_NOT_ONE_PLAN/);
});

test('check-plan --compare-file: a referenced plan that is not on disk fails loudly', () => {
  const r = cli({ files: [plan()] });
  assert.equal(r.code, 1);
  assert.match(r.err, /cannot read plans\/x\.md/);
});

test('check-plan --compare-file: --json prints a single object', () => {
  const r = cli({ files: [plan('plans/a.md'), plan('plans/b.md')] }, { extra: ['--json'] });
  assert.equal(r.code, 1);
  const o = JSON.parse(r.out);
  assert.equal(o.ok, false);
  assert.equal(o.faults[0].code, C.PR_NOT_ONE_PLAN);
});

test('check-plan --compare-file: bad input fails loudly', () => {
  assert.equal(cli('not json').code, 1);
  assert.equal(cli({}).code, 1);
  assert.equal(cli({ files: 'x' }).code, 1);
});

test('check-plan: exactly one of --file and --compare-file', () => {
  const r = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /exactly one of/);
});
