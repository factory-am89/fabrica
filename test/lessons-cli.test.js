// scripts/lessons.mjs: the reader of the lesson registry. The fixture is a temp repo root (copy of the
// vocabulary sources plus a few lessons), removed in t.after; no network, no process spawned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from '../scripts/lib/exit.mjs';
import { lessonContext, mechanismKind } from '../scripts/lib/lessons.mjs';
import { cliLessons } from '../scripts/lessons.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL = lessonContext(RAIZ);

// Root with the files the validator reads; the intervenciones.md has one dated row at line 2.
function fixtureRoot(t, lessons) {
  const root = mkdtempSync(path.join(tmpdir(), 'fabrica-lessons-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(path.join(RAIZ, 'standards'), path.join(root, 'standards'), { recursive: true });
  cpSync(path.join(RAIZ, '.claude', 'agents'), path.join(root, '.claude', 'agents'), { recursive: true });
  writeFileSync(path.join(root, 'intervenciones.md'), '# header\n2026-01-01 | clic | a | b | repetida: no\n');
  mkdirSync(path.join(root, 'test'));
  mkdirSync(path.join(root, 'lessons'));
  for (const [id, d] of Object.entries(lessons)) {
    writeFileSync(path.join(root, 'lessons', `${id}.json`), typeof d === 'string' ? d : JSON.stringify(d));
    if (typeof d !== 'string') writeFileSync(path.join(root, d.mechanism), `// lesson: ${id}\n`);
  }
  return root;
}
const lesson = (over) => ({ v: 1, class: REAL.classes[0], source: 'intervenciones.md:2', mechanism: 'test/a.test.js', origin: REAL.origins[0], ...over });

const THREE = () => ({
  one: lesson({ mechanism: 'test/a.test.js' }),
  two: lesson({ mechanism: 'test/b.test.js', origin: REAL.origins[1] }),
  three: lesson({ mechanism: 'test/c.test.js', class: 'none' }),
});

test('good case: exit OK, human text names the counts', (t) => {
  const r = cliLessons([fixtureRoot(t, THREE())]);
  assert.equal(r.code, EXIT.OK);
  assert.match(r.stdout, /lessons: 3/);
  assert.match(r.stdout, new RegExp(`${REAL.classes[0]}: 2`));
  assert.match(r.stdout, /test: 3/);
});

test('the real registry is green and readable', () => {
  assert.equal(cliLessons([]).code, EXIT.OK);
});

test('--json: stdout is exactly one parseable object and its counts match the fixture', (t) => {
  const r = cliLessons(['--json', fixtureRoot(t, THREE())]);
  assert.equal(r.code, EXIT.OK);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  const d = JSON.parse(r.stdout);
  assert.equal(d.ok, true);
  assert.equal(d.total, 3);
  assert.deepEqual(d.byClass, { [REAL.classes[0]]: 2, none: 1 });
  assert.deepEqual(d.byMechanism, { [mechanismKind('test/a.test.js')]: 3 });
  assert.deepEqual(d.byOrigin, { [REAL.origins[0]]: 2, [REAL.origins[1]]: 1 });
  assert.deepEqual(d.faults, []);
});

test('a bad lesson: the lessons exit code, the fault code listed, human and json', (t) => {
  const root = fixtureRoot(t, { ...THREE(), bad: '{"v": 1,' });
  const h = cliLessons([root]);
  assert.equal(h.code, EXIT.LESSON_FAULTS);
  assert.match(h.stderr, /NOT_JSON/);
  const j = cliLessons(['--json', root]);
  assert.equal(j.code, EXIT.LESSON_FAULTS);
  const d = JSON.parse(j.stdout);
  assert.equal(d.ok, false);
  assert.equal(d.exit, EXIT.LESSON_FAULTS);
  assert.deepEqual(d.faults.map((f) => f.code), ['NOT_JSON']);
  assert.equal(d.total, 4);
  assert.equal(Object.values(d.byClass).reduce((a, b) => a + b, 0), 3, 'the faulty lesson is not counted');
});
