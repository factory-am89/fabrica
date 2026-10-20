// scripts/audit.mjs: every indicator of INDICATORS is measured from a throwaway root built here, and each test
// goes red when its indicator is broken. Vocabulary comes from the scripts/lib modules, never retyped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDICATORS, LONG_FILE_LINES, MIN_DUP_LENGTH, audit, cliAudit, exportedStrings } from '../scripts/audit.mjs';
import { BASE_HOLE, ENTITIES_FILE, HORIZONTAL } from '../scripts/lib/entities.mjs';
import { EXIT } from '../scripts/lib/exit.mjs';
import { CLASES, FALTAS, ORIGENES, ORIGEN_AGENTE, registrarIntervencion, rutaDeRegistroIntervenciones } from '../scripts/lib/intervention-log.mjs';
import { INTERVENCIONES_FILE, LESSONS_DIR, REASON_SINGLE, STANDARDS, SIGNAL_MACHINE, SIGNAL_NONE } from '../scripts/lib/lessons.mjs';
import { CHECKED_BY, FIELDS } from '../scripts/lib/questions.mjs';
import { RULES_BUDGET_FILE } from '../scripts/lib/skills.mjs';
import { marcar } from '../scripts/hitl.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'audit.mjs');
const NO_LOG = 'no-such-log.jsonl';

function put(root, rel, text) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), text);
}
const question = (n, who) => `### Q${n} — text\n${FIELDS.checkedBy.label}: ${who}\n\n`;
const manyLines = (n) => `${'// x\n'.repeat(n)}`;

// A root with every source the audit reads, each in a known state; `over` replaces files by relative path.
function fixture(t, over = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'fabrica-audit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    [STANDARDS[0]]: question(1, CHECKED_BY.machine) + question(2, CHECKED_BY.reviewer) + question(3, CHECKED_BY.reviewer),
    [`${LESSONS_DIR}/a.json`]: JSON.stringify({ signal: SIGNAL_MACHINE, reason: [REASON_SINGLE] }),
    [`${LESSONS_DIR}/b.json`]: JSON.stringify({ signal: SIGNAL_NONE, reason: [REASON_SINGLE] }),
    [`${LESSONS_DIR}/c.json`]: JSON.stringify({ signal: SIGNAL_MACHINE }),
    [RULES_BUDGET_FILE]: JSON.stringify({ budget: { uno: 3, dos: 4 } }),
    [INTERVENCIONES_FILE]: '# h\n2026-01-01 | clic | a | b | repetida: no\n2026-01-02 | clic | a | b | repetida: no\nsuelta\n',
    [ENTITIES_FILE]: JSON.stringify({ entities: [{ id: 'e1', scope: HORIZONTAL, base: BASE_HOLE }, { id: 'e2', scope: HORIZONTAL, base: 'x.md' }] }),
    'scripts/con.mjs': "console.log('--json');\n",
    'scripts/sin.mjs': 'export const a = 1;\n',
    'scripts/lib/vocab.mjs': 'export const WORDS = [\n  \'vocabulary-word\', \'tiny\',\n];\nconst PRIVATE = \'private-word-here\';\n',
    'test/uses.test.js': "const a = 'vocabulary-word'; const b = 'tiny'; const c = 'private-word-here';\n",
    ...over,
  };
  for (const [rel, text] of Object.entries(files)) put(root, rel, text);
  return root;
}
const run = (root) => audit(root, { logPath: path.join(root, NO_LOG) });

test('INDICATORS is the closed list: the audit returns exactly one value per id', (t) => {
  const ids = Object.values(INDICATORS);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(Object.keys(run(fixture(t))).sort(), [...ids].sort());
});

test('questions are counted by who checks them', (t) => {
  const q = run(fixture(t))[INDICATORS.questions];
  assert.equal(q.total, 3);
  assert.deepEqual(q.byCheckedBy, { [CHECKED_BY.machine]: 1, [CHECKED_BY.reviewer]: 2 });
});

test('lessons are counted by signal and by reason', (t) => {
  const r = run(fixture(t));
  assert.deepEqual(r[INDICATORS.lessonsSignal], { total: 3, bySignal: { [SIGNAL_MACHINE]: 2, [SIGNAL_NONE]: 1 } });
  assert.deepEqual(r[INDICATORS.lessonsReason], { [REASON_SINGLE]: 2 });
});

test('rules without reader reads the budget of the ratchet, it does not recompute the bullets', (t) => {
  const r = run(fixture(t))[INDICATORS.rulesWithoutReader];
  assert.equal(r.total, 7);
  assert.deepEqual(r.bySkill, { uno: 3, dos: 4 });
});

test('hitl: self-declared marks come from the log through marcar; table rows from intervenciones.md', (t) => {
  const root = fixture(t);
  const log = path.join(root, 'log', path.basename(rutaDeRegistroIntervenciones()));
  mkdirSync(path.dirname(log));
  marcar(CLASES[0], FALTAS[0], undefined, { ruta: log });
  registrarIntervencion({ clase: CLASES[0], origen: ORIGENES.find((o) => o !== ORIGEN_AGENTE), falta: FALTAS[0], ruta: log });
  const h = audit(root, { logPath: log })[INDICATORS.hitlSelfDeclared];
  assert.deepEqual(h, { selfDeclared: 1, total: 2, corrupt: [], tableRows: 2 });
  assert.equal(run(root)[INDICATORS.hitlSelfDeclared].selfDeclared, 0);
});

test('hitl: an unreadable line of the log is shown, not lost', (t) => {
  const root = fixture(t);
  const log = path.join(root, NO_LOG);
  writeFileSync(log, 'not json\n');
  const h = audit(root, { logPath: log })[INDICATORS.hitlSelfDeclared];
  assert.deepEqual([h.total, h.corrupt], [1, [1]]);
});

test('scripts without --json lists the root scripts that do not cite it', (t) => {
  const s = run(fixture(t))[INDICATORS.scriptsWithoutJson];
  assert.deepEqual(s, { total: 2, count: 1, files: ['scripts/sin.mjs'] });
});

test('long files: over the limit is listed, exactly at the limit is not', (t) => {
  const root = fixture(t, { 'scripts/largo.mjs': manyLines(LONG_FILE_LINES + 1), 'test/justo.test.js': manyLines(LONG_FILE_LINES) });
  const l = run(root)[INDICATORS.longFiles];
  assert.deepEqual(l.files, [{ file: 'scripts/largo.mjs', lines: LONG_FILE_LINES + 1 }]);
  assert.equal(l.count, 1);
});

test('magic numbers: a number in a comparison counts, 0 and 1 do not', (t) => {
  const root = fixture(t, { 'scripts/num.mjs': 'export const f = (x) => (x > 4242 ? 1 : 0);\n' });
  const m = run(root)[INDICATORS.magicNumbers];
  assert.deepEqual(m.files, [{ file: 'scripts/num.mjs', count: 1 }]);
  assert.equal(m.count, 1);
});

test('magic numbers: only the rule counts (an unused eslint-disable is not a number) and an unreadable file fails loudly', (t) => {
  const ok = fixture(t, { 'scripts/num.mjs': '// eslint-disable-next-line no-undef\nexport const f = (x) => (x > 4242 ? 1 : 0);\n' });
  assert.equal(run(ok)[INDICATORS.magicNumbers].count, 1);
  const bad = fixture(t, { 'scripts/roto.mjs': 'export const x = (;\n' });
  assert.throws(() => run(bad), /could not read.*roto\.mjs/);
});

test('base holes lists the entities whose base is a hole', (t) => {
  assert.deepEqual(run(fixture(t))[INDICATORS.baseHoles].holes, ['e1']);
});

test('test duplication: a long exported string found in a test is listed with both files', (t) => {
  const d = run(fixture(t))[INDICATORS.testDuplication];
  assert.equal(d.minLength, MIN_DUP_LENGTH);
  assert.deepEqual(d.values, [{ value: 'vocabulary-word', tests: ['test/uses.test.js'], lib: ['scripts/lib/vocab.mjs'] }]);
});

test('test duplication: a string shorter than the minimum, or not in an export const, is not listed', (t) => {
  const short = 'x'.repeat(MIN_DUP_LENGTH - 1);
  const root = fixture(t, { 'scripts/lib/vocab.mjs': `export const W = ['${short}'];\n`, 'test/uses.test.js': `const a = '${short}'; const b = 'not-exported-anywhere';\n` });
  assert.equal(run(root)[INDICATORS.testDuplication].count, 0);
  assert.deepEqual(exportedStrings("const P = 'private-word-here';\nexport const E = 'exported-word';\n// export const C = 'comment-word';\n"), ['exported-word']);
});

test('signals, not gates: a root full of faults still exits OK, in text and in --json', (t) => {
  const root = fixture(t, { 'scripts/largo.mjs': manyLines(LONG_FILE_LINES * 2) });
  assert.equal(cliAudit([root]).code, EXIT.OK);
  const j = cliAudit(['--json', root]);
  assert.equal(j.code, EXIT.OK);
  assert.equal(JSON.parse(j.stdout).ok, true);
});

test('the real entry point: node scripts/audit.mjs --json prints one JSON object with every indicator', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--json'], { encoding: 'utf8', cwd: RAIZ });
  assert.equal(r.status, EXIT.OK, r.stderr);
  const out = JSON.parse(r.stdout);
  for (const id of Object.values(INDICATORS)) assert.ok(Object.hasOwn(out, id), `missing ${id}`);
});
