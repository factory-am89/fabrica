// Abstraction validation (chunk 23 of plans/trabajar-solos.md): bad cases the mechanisms must catch, one per row of the table
// «Abstraction validation». Each `machine` case is run through the real entry point (a CLI, or `node --test` on a test file) inside
// a temporary copy of the repo, never the repo: the case is a list of file edits (fixtures/invariants/<id>/data.json) and what must
// show up (cases.json). Its control is the same command with no edit (or with the `control` edits) and must pass, so the case is
// red for its own reason. Prints «caught/total» per invariant and the cell as «no concluyente» under MIN_CASES_PER_CELL; fails on a miss.
// A case no mechanism catches is never weakened: it becomes `ninguno` with its motive and a lesson, in the diff.
// Not covered: the cases of `juez` and `ninguno` are only counted and shaped here; the judge's are run by the corpus (chunk 24).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MIN_CASES_PER_CELL } from '../scripts/golden.mjs';
import { ADOPTED_FAULTS } from '../scripts/lib/adopted.mjs';
import { DECISION_FAULTS } from '../scripts/lib/decision.mjs';
import { ENTITY_FAULTS } from '../scripts/lib/entities.mjs';
import { FIELD_FAULTS } from '../scripts/lib/fields.mjs';
import { CHECK, GOAL_FAULTS, KEY, LIST, readGoals } from '../scripts/lib/goals.mjs';
import { CODES } from '../scripts/lib/hygiene.mjs';
import { LESSON_FAULTS, NO_LESSON_FAULTS } from '../scripts/lib/lessons.mjs';
import { PLAN_FAULTS } from '../scripts/lib/plan.mjs';
import { SKILL_FAULTS } from '../scripts/lib/skills.mjs';
import { TRIGGER_FAULTS } from '../scripts/lib/triggers.mjs';

const HERE = import.meta.dirname;
const ROOT = path.join(HERE, '..');
const CASES_DIR = path.join(HERE, 'fixtures', path.basename(import.meta.filename, '.test.js'));
const FAULT_SETS = { ADOPTED_FAULTS, CODES, DECISION_FAULTS, ENTITY_FAULTS, FIELD_FAULTS, GOAL_FAULTS, LESSON_FAULTS, NO_LESSON_FAULTS, PLAN_FAULTS, SKILL_FAULTS, TRIGGER_FAULTS };
// The detectors are the words of goals.json «check» (who checks a rule today), read from goals-shape.mjs and not retyped.
const DETECTORS = { machine: CHECK.machine, judge: CHECK.judge, none: CHECK.nobody };
const INVARIANTS = readGoals(ROOT)[LIST.invariants].map((i) => i[KEY.id]);
// Not `expected.json`: golden-run.test.js requires that no file of that name reaches the judge's workspace.
const CASES_FILE = 'cases.json';
const EXIT_OK = 'ok';
const [TEST_FLAG, REPORTER, FAILED_TITLE] = ['--test', '--test-reporter=dot', '✖'];
const SKIPPED = ['.git', 'node_modules'];
const cases = JSON.parse(readFileSync(path.join(CASES_DIR, CASES_FILE), 'utf8')).cases;
const machine = cases.filter((c) => c.detector === DETECTORS.machine);
const dataOf = (c) => JSON.parse(readFileSync(path.join(CASES_DIR, c.id, 'data.json'), 'utf8'));

// The copy of the repo every command runs in; its node_modules is a junction to the real one, removed as a link before the folder.
const work = mkdtempSync(path.join(tmpdir(), 'invariants-'));
const repo = path.join(work, 'repo');
cpSync(ROOT, repo, { recursive: true, filter: (src) => !SKIPPED.includes(path.basename(src)) && !path.basename(src).startsWith('.tmp') });
symlinkSync(path.join(ROOT, 'node_modules'), path.join(repo, 'node_modules'), 'junction');
mkdirSync(path.join(work, 'home'));
after(() => {
  unlinkSync(path.join(repo, 'node_modules'));
  rmSync(work, { recursive: true, force: true });
});

const at = (p) => path.join(repo, p);
const count = (text, part) => text.split(part).length - 1;

// One edit of the copy. `replace` must find its text exactly once: an edit that does not apply is a broken fixture, not a miss.
function apply(op, was) {
  const target = at(op.write ?? op.replace ?? op.append ?? op.to);
  if (!was.has(target)) was.set(target, existsSync(target) ? readFileSync(target, 'utf8') : null);
  mkdirSync(path.dirname(target), { recursive: true });
  const text = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (op.copy !== undefined) writeFileSync(target, readFileSync(at(op.copy), 'utf8'));
  else if (op.write !== undefined) writeFileSync(target, op.json === undefined ? op.text : `${JSON.stringify(op.json, null, 2)}\n`);
  else if (op.append !== undefined) writeFileSync(target, text + op.text);
  else {
    assert.equal(count(text, op.from), 1, `the edit does not apply to ${op.replace}: ${JSON.stringify(op.from.slice(0, 60))} found ${count(text, op.from)} times`);
    writeFileSync(target, text.replace(op.from, () => op.to));
  }
}

// Runs `argv` in the copy with the edits applied, then puts every touched file back.
function runWith(argv, ops = []) {
  const was = new Map();
  try {
    for (const op of ops) apply(op, was);
    const env = { ...process.env, HOME: path.join(work, 'home'), USERPROFILE: path.join(work, 'home') };
    delete env.NODE_TEST_CONTEXT;
    // The dot reporter prints no title for a passing test; the title of a failing one is dropped, so a needle must come from the failure itself.
    const withReporter = argv[0] === TEST_FLAG ? [TEST_FLAG, REPORTER, ...argv.slice(1)] : argv;
    const r = spawnSync(process.execPath, withReporter, { cwd: repo, env, encoding: 'utf8' });
    return { ok: r.status === 0, out: `${r.stdout}\n${r.stderr}`.split('\n').filter((l) => !l.startsWith(FAILED_TITLE)).join('\n') };
  } finally {
    for (const [file, text] of was) {
      if (text === null) rmSync(file, { force: true });
      else writeFileSync(file, text);
    }
  }
}

// What must show up: a fault code of a *_FAULTS export (the value is read from the export, so a renamed code fails loudly), or a text.
function needles(c) {
  return c.catch.map((n) => {
    if (n.text !== undefined) return n.text;
    assert.ok(Object.hasOwn(FAULT_SETS, n.set) && Object.hasOwn(FAULT_SETS[n.set], n.code), `${c.id}: ${n.set}.${n.code} is not an exported fault code`);
    return n.with === undefined ? FAULT_SETS[n.set][n.code] : `${FAULT_SETS[n.set][n.code]} ${n.with}`;
  });
}

// The control is the same command with no edit (or with `control`): it must pass and show none of the needles.
const controls = new Map();
function control(c, d) {
  const argv = d.control?.run ?? d.run;
  const key = JSON.stringify([argv, d.control?.ops ?? []]);
  if (!controls.has(key)) controls.set(key, runWith(argv, d.control?.ops));
  return { ...controls.get(key), shown: needles(c).filter((n) => controls.get(key).out.includes(n)) };
}

// Caught: every needle shows up and the exit is the expected one (a failure, unless the case says the signal is printed with exit 0).
function caught(c, d) {
  const r = runWith(d.run, d.ops);
  const found = needles(c).filter((n) => r.out.includes(n));
  return { yes: found.length === c.catch.length && r.ok === (c.exit === EXIT_OK), out: r.out };
}

const isBad = (r) => !r.ok || r.shown.length > 0;

// One cell (invariant x detector) as the table prints it: «caught/total» for machine, only the count for the others, and «no concluyente»
// under MIN_CASES_PER_CELL cases.
const NOT_CONCLUSIVE = 'no concluyente';
const label = (detector, total, hit) => [detector, detector === DETECTORS.machine ? [hit, total].join('/') : total, ...(total < MIN_CASES_PER_CELL ? [NOT_CONCLUSIVE] : [])].join(' ');
const table = (hits, list = cases) => INVARIANTS.map((inv) => {
  const cells = Object.values(DETECTORS).map((d) => label(d, list.filter((c) => c.invariant === inv && c.detector === d).length, hits.filter((h) => h.c.invariant === inv && h.yes).length));
  return `${inv}: ${cells.join('; ')}`;
});

test('the cases are well formed: closed detectors, invariants of goals.json, one folder per machine case and nothing else', () => {
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length, 'repeated case id');
  for (const c of cases) {
    assert.ok(INVARIANTS.includes(c.invariant), `${c.id}: ${c.invariant} is not an invariant of goals.json`);
    assert.ok(Object.values(DETECTORS).includes(c.detector), `${c.id}: unknown detector ${c.detector}`);
    if (c.detector === DETECTORS.machine) assert.ok(c.catch.length > 0 && existsSync(path.join(CASES_DIR, c.id, 'data.json')), `${c.id}: a machine case needs catch and data.json`);
    else assert.ok(c.why.trim() !== '' && !existsSync(path.join(CASES_DIR, c.id)), `${c.id}: a ${c.detector} case needs a motive and has no data`);
  }
  const folders = readdirSync(CASES_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.deepEqual(folders, machine.map((c) => c.id).sort());
});

test('the table says «no concluyente» exactly under MIN_CASES_PER_CELL, and «caught/total» only for machine', () => {
  const [few, enough] = [MIN_CASES_PER_CELL - 1, MIN_CASES_PER_CELL];
  assert.equal(label(DETECTORS.machine, few, few - 1), `${DETECTORS.machine} ${few - 1}/${few} ${NOT_CONCLUSIVE}`);
  assert.equal(label(DETECTORS.machine, enough, enough), `${DETECTORS.machine} ${enough}/${enough}`);
  assert.equal(label(DETECTORS.judge, few, 0), `${DETECTORS.judge} ${few} ${NOT_CONCLUSIVE}`);
  assert.equal(label(DETECTORS.none, enough, 0), `${DETECTORS.none} ${enough}`);
  const two = [{ invariant: INVARIANTS[0], detector: DETECTORS.machine }, { invariant: INVARIANTS[0], detector: DETECTORS.machine }];
  assert.ok(table([{ c: two[0], yes: true }, { c: two[1], yes: false }], two)[0].startsWith(`${INVARIANTS[0]}: ${DETECTORS.machine} 1/2`), 'only the caught ones count, machine first');
});

test('a command runs isolated (own home so no control writes to the real ~/.fabrica, no test context), and the title of a failed test is dropped', () => {
  assert.equal(runWith(['-p', 'os.homedir() + " " + process.env.NODE_TEST_CONTEXT']).out.trim(), `${path.join(work, 'home')} undefined`);
  const titled = runWith(['-p', JSON.stringify(`${FAILED_TITLE} a title\nthe failure`)]).out;
  assert.ok(titled.includes('the failure') && !titled.includes('a title'));
});

test('caught() needs every needle and the expected exit; a control is bad if it fails or shows a needle; an edit must apply once', () => {
  assert.equal(isBad({ ok: true, shown: ['x'] }), true);
  assert.equal(isBad({ ok: false, shown: [] }), true);
  assert.equal(isBad({ ok: true, shown: [] }), false);
  assert.deepEqual(needles({ id: 'x', catch: [{ set: 'CODES', code: 'MERGE', with: 'key' }, { text: 't' }] }), [`${CODES.MERGE} key`, 't']);
  assert.throws(() => needles({ id: 'x', catch: [{ set: 'CODES', code: 'NO_SUCH' }] }), /not an exported fault code/);
  assert.throws(() => apply({ replace: 'package.json', from: 'absent text', to: 'x' }, new Map()), /does not apply/);
  assert.throws(() => apply({ replace: 'package.json', from: '"', to: 'x' }, new Map()), /does not apply/);
  const run = { run: ['-p', '"x"'] };
  assert.equal(caught({ catch: [{ text: 'x' }] }, run).yes, false, 'exit 0 where a failure was expected');
  assert.equal(caught({ catch: [{ text: 'x' }], exit: EXIT_OK }, run).yes, true);
  assert.equal(caught({ catch: [{ text: 'x' }, { text: 'never printed' }], exit: EXIT_OK }, run).yes, false, 'one needle missing');
  assert.equal(caught({ catch: [{ text: 'x' }], exit: EXIT_OK }, { run: ['-e', 'console.log("x"); process.exit(1)'] }).yes, false, 'exit 1 where 0 was expected');
});

test('every machine case is caught through the real entry point, and its control passes', () => {
  const hits = machine.map((c) => ({ c, ...caught(c, dataOf(c)) }));
  const badControl = machine.map((c) => ({ c, r: control(c, dataOf(c)) })).filter((x) => isBad(x.r));
  const lines = table(hits);
  console.log(`${lines.join('\n')}\nmachine: ${hits.filter((h) => h.yes).length}/${machine.length}`);
  assert.equal(lines.length, INVARIANTS.length);
  for (const inv of INVARIANTS) {
    const own = hits.filter((h) => h.c.invariant === inv);
    assert.ok(lines.find((l) => l.startsWith(`${inv}:`)).includes(`${DETECTORS.machine} ${own.filter((h) => h.yes).length}/${own.length}`), `${inv}: the table does not match the cases run`);
  }
  const why = (r) => (r.ok ? `the control already shows ${r.shown}` : 'the control did not pass');
  const badControlText = badControl.map((x) => `${x.c.id}: ${why(x.r)}\n${x.r.out.slice(-600)}`);
  const missed = hits.filter((h) => !h.yes).map((h) => `${h.c.id}\n${h.out.slice(-600)}`);
  assert.deepEqual({ missed, badControl: badControlText }, { missed: [], badControl: [] }, 'missed: make the case `ninguno` with its motive and a lesson, never weaker; badControl: the control is not green, so the case proves nothing');
});

