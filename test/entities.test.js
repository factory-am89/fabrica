// entities.json: the real registry is read through the real entry point (`npm test` collects this file; the CLI is
// spawned as a process), and each fault code has a bad case that turns it red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTITY_FAULTS, baseHoles, entityFaults, readEntities } from '../scripts/lib/entities.mjs';
import { cliEntities } from '../scripts/entities.mjs';
import { EXIT } from '../scripts/lib/exit.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const real = () => readEntities(RAIZ);
const good = () => ({ id: 'x', name: 'X', scope: 'horizontal', term: 'x', source_of_truth: 'CLAUDE.md', readers: ['CLAUDE.md'], base: 'base/skill.md', forge: 'scripts/lib/skills.mjs' });
const codes = (entities) => entityFaults({ entities }, RAIZ).map((f) => f.code);

test('the real registry has no fault, and every path of source_of_truth, base, forge and readers exists', () => {
  const registry = real();
  assert.deepEqual(entityFaults(registry, RAIZ), []);
  for (const e of registry.entities) {
    const paths = [e.source_of_truth, ...e.readers, e.forge, e.base !== 'hueco' ? e.base : undefined];
    for (const p of paths.filter((x) => x && x !== 'none')) assert.ok(existsSync(path.join(RAIZ, p)), `${e.id}: ${p}`);
  }
});

test('the registry holds the entities the plan asks for, the role is a base hole and skill and standard have a base', () => {
  const byId = Object.fromEntries(real().entities.map((e) => [e.id, e]));
  for (const id of ['project', 'lesson', 'review-record', 'intervention', 'message', 'session', 'question', 'plan', 'skill', 'role', 'standard', 'rule']) {
    assert.ok(byId[id], id);
  }
  assert.equal(byId.role.base, 'hueco');
  assert.ok(baseHoles(real()).includes('role'));
  assert.equal(byId.skill.base, 'base/skill.md');
  assert.equal(byId.standard.base, 'base/standard.md');
});

test('every horizontal entity has base and forge, or a hole with a closed reason', () => {
  for (const e of real().entities.filter((x) => x.scope === 'horizontal')) {
    if (e.base === 'hueco') assert.ok(['sin-forja', 'otro'].includes(e.base_reason), e.id);
    else assert.ok(e.base && e.forge, e.id);
  }
});

test('good case is green; each fault code has a bad case that turns it red', () => {
  assert.deepEqual(codes([good()]), []);
  assert.deepEqual(entityFaults({}, RAIZ).map((f) => f.code), [ENTITY_FAULTS.BAD_REGISTRY]);
  assert.deepEqual(codes([{ ...good(), term: undefined }]), [ENTITY_FAULTS.MISSING_FIELD]);
  assert.deepEqual(codes([good(), good()]), [ENTITY_FAULTS.DUPLICATE_ID]);
  assert.deepEqual(codes([{ ...good(), scope: 'lateral' }]), [ENTITY_FAULTS.BAD_VALUE]);
  assert.deepEqual(codes([{ ...good(), readers: ['no/existe.mjs'] }]), [ENTITY_FAULTS.MISSING_PATH]);
  assert.deepEqual(codes([{ ...good(), forge: undefined }]), [ENTITY_FAULTS.HORIZONTAL_WITHOUT_BASE]);
  assert.deepEqual(codes([{ ...good(), base: 'hueco', base_reason: 'porque-si' }]), [ENTITY_FAULTS.BAD_HOLE]);
  assert.deepEqual(codes([{ ...good(), base: 'hueco', base_reason: 'otro' }]), [ENTITY_FAULTS.BAD_HOLE]);
  assert.deepEqual(codes([{ ...good(), base: 'hueco', base_reason: 'sin-forja' }]), []);
});

test('the CLI (cliEntities and a spawned process) prints the whole registry: one JSON object, ok', () => {
  const r = cliEntities(['--json']);
  assert.equal(r.code, EXIT.OK);
  const d = JSON.parse(r.stdout);
  assert.equal(d.ok, true);
  assert.equal(d.entities.length, real().entities.length);
  const p = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'entities.mjs'), '--json'], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  assert.equal(JSON.parse(p.stdout).entities.length, d.entities.length);
});

test('a registry with a fault fails loudly through the CLI (exit is not OK, stdout names the error)', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'fabrica-entities-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ghost = { id: 'ghost', name: 'G', scope: 'vertical', term: 'g', source_of_truth: 'no/existe.md', readers: [] };
  writeFileSync(path.join(root, 'entities.json'), JSON.stringify({ entities: [ghost] }));
  const p = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'entities.mjs'), '--json', root], { encoding: 'utf8' });
  assert.notEqual(p.status, 0);
  assert.equal(JSON.parse(p.stdout).ok, false);
  assert.match(p.stderr, /MISSING_PATH/);
});
