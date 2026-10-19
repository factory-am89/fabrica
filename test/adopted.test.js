// Check of an adopted project (scripts/adopted.mjs): one bad case per fault code, a good case, and the real CLI
// over the committed fixture. Project folders are temp copies removed in t.after; the vocabulary is imported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from '../scripts/lib/exit.mjs';
import { ADOPTED_FAULTS, BASE_DIR, ROLES_DIR, SKILLS_DIR, adoptedFaults, normalize, readInherited } from '../scripts/lib/adopted.mjs';
import { ENTITIES_FILE } from '../scripts/lib/entities.mjs';
import { cliAdopted } from '../scripts/adopted.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(REPO, 'test', 'fixtures', 'adopted', 'mezclado');
const INHERITED = readInherited(REPO);

// A project folder with the given files (path -> text); an empty object is a clean project.
function project(t, filesByPath = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fabrica-adopted-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(filesByPath)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}
const codes = (dir) => adoptedFaults(dir, INHERITED).map((f) => f.code);
const registry = (...entities) => JSON.stringify({ entities });
const horizontal = INHERITED.entities[0];

test('good case: a project with its own role, skill and entity has no faults', (t) => {
  const dir = project(t, {
    [`${ROLES_DIR}/analista.md`]: '---\nname: analista\n---\nOtra cosa distinta.\n',
    [`${SKILLS_DIR}/propia/SKILL.md`]: 'x\n',
    [ENTITIES_FILE]: registry({ id: 'menu', name: 'Menú', term: 'menú', scope: 'vertical' }),
  });
  assert.deepEqual(codes(dir), []);
});

test('OWN_ROLE: a role with the name of an inherited one, and one under another name that repeats its lines', (t) => {
  const inherited = INHERITED.roles[0];
  const same = project(t, { [`${ROLES_DIR}/${inherited.file}`]: 'cualquier cosa\n' });
  assert.deepEqual(codes(same), [ADOPTED_FAULTS.OWN_ROLE]);
  const renamed = project(t, { [`${ROLES_DIR}/builder.md`]: [...inherited.lines].join('\n') });
  assert.deepEqual(codes(renamed), [ADOPTED_FAULTS.OWN_ROLE]);
});

test('OWN_SKILL: a skill with the name of an inherited one', (t) => {
  assert.deepEqual(codes(project(t, { [`${SKILLS_DIR}/${INHERITED.skills[0]}/SKILL.md`]: 'x\n' })), [ADOPTED_FAULTS.OWN_SKILL]);
});

test('OWN_FORGE: a file at the path of an inherited forge', (t) => {
  assert.deepEqual(codes(project(t, { [INHERITED.forges[0]]: '// copy\n' })), [ADOPTED_FAULTS.OWN_FORGE]);
});

test('OWN_BASE: a copy of an inherited base', (t) => {
  const base = INHERITED.bases.find((b) => b.startsWith(`${BASE_DIR}/`));
  assert.deepEqual(codes(project(t, { [base]: '# copy\n' })), [ADOPTED_FAULTS.OWN_BASE]);
});

test('OWN_TEMPLATE: a copy of an inherited template', (t) => {
  assert.deepEqual(codes(project(t, { [INHERITED.templates[0]]: 'copy\n' })), [ADOPTED_FAULTS.OWN_TEMPLATE]);
});

test('REDEFINED_ENTITY: by id, by name and by term, the last two ignoring case and accents', (t) => {
  const byId = project(t, { [ENTITIES_FILE]: registry({ id: horizontal.id, name: 'x', term: 'y' }) });
  assert.deepEqual(codes(byId), [ADOPTED_FAULTS.REDEFINED_ENTITY]);
  const byName = project(t, { 'ops/entidades.json': registry({ id: 'otro-id', name: ` ${horizontal.name.toUpperCase()} `, term: 'y' }) });
  assert.deepEqual(codes(byName), [ADOPTED_FAULTS.REDEFINED_ENTITY]);
  const byTerm = project(t, { [ENTITIES_FILE]: registry({ id: 'otro-id', name: 'x', term: horizontal.term.normalize('NFD') }) });
  assert.deepEqual(codes(byTerm), [ADOPTED_FAULTS.REDEFINED_ENTITY]);
});

// Every code of ADOPTED_FAULTS needs a bad case: test/golden-machine.test.js checks it for every *_FAULTS export.
test('normalize folds case, accents and spaces', () => {
  assert.equal(normalize(' Sesión  Nueva '), 'sesion nueva');
});

test('an unreadable registry fails loudly, it is not read as «no entities»', (t) => {
  assert.throws(() => codes(project(t, { [ENTITIES_FILE]: '{no json' })), /not readable JSON/);
  assert.throws(() => codes(project(t, { [ENTITIES_FILE]: '{}' })), /no «entities» list/);
  assert.throws(() => adoptedFaults(path.join(tmpdir(), 'fabrica-adopted-no-existe'), INHERITED), /does not exist/);
});

test('cliAdopted: no --dir is USAGE, a clean project is OK, the fixture is ADOPTED_FAULTS with the faults in --json', (t) => {
  assert.equal(cliAdopted([]).code, EXIT.USAGE);
  assert.equal(cliAdopted(['--dir', project(t)]).code, EXIT.OK);
  const r = cliAdopted(['--dir', FIXTURE, '--json']);
  assert.equal(r.code, EXIT.ADOPTED_FAULTS);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'ADOPTED_FAULTS');
  assert.equal(out.byFault[ADOPTED_FAULTS.OWN_ROLE], 1);
});

// The Done goes through the real entry point: the process exit code, not the function.
test('the real CLI exits with the ADOPTED_FAULTS code over the fixture and 0 over a clean folder', (t) => {
  const run = (dir) => spawnSync(process.execPath, [path.join(REPO, 'scripts', 'adopted.mjs'), '--dir', dir, '--json'], { encoding: 'utf8' });
  const bad = run(FIXTURE);
  assert.equal(bad.status, EXIT.ADOPTED_FAULTS);
  assert.equal(JSON.parse(bad.stdout).ok, false);
  assert.equal(run(project(t)).status, EXIT.OK);
});
