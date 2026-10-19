// La forja mínima de skills (base/skill.md): una sola, la misma para cualquier skill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { comprobarSkill, carpetasDeSkills, MAX_LINEAS, REVISAR_DIAS, leerFrontmatter, skillsViejas, faltasDeReglasSinLector, RULES_BUDGET_FILE, SKILL_FAULTS } from '../scripts/lib/skills.mjs';
import { SIGNAL_MACHINE } from '../scripts/lib/lessons.mjs';
import { readEntities } from '../scripts/lib/entities.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOY = '2026-10-15';

const BIEN = `---
name: prueba
description: Úsala al probar la forja. No para: nada más.
dueño: constructor
comprobado: 2026-10-01
---

# Prueba

## Lo que falló

- **2026-10-01 · algo.** Causa: x. Arreglo: y.
`;

// Una skill de mentira en una raíz temporal que tiene el agente `constructor`.
function skill(texto, extra = {}, hoy = HOY) {
  const raiz = mkdtempSync(path.join(tmpdir(), 'forja-'));
  mkdirSync(path.join(raiz, '.claude', 'agents'), { recursive: true });
  writeFileSync(path.join(raiz, '.claude', 'agents', 'constructor.md'), '---\nname: constructor\n---\n');
  const carpeta = path.join(raiz, '.claude', 'skills', 'prueba');
  mkdirSync(carpeta, { recursive: true });
  writeFileSync(path.join(carpeta, 'SKILL.md'), texto);
  for (const [ruta, contenido] of Object.entries(extra)) {
    mkdirSync(path.dirname(path.join(carpeta, ruta)), { recursive: true });
    writeFileSync(path.join(carpeta, ruta), contenido);
  }
  return comprobarSkill(carpeta, { raiz, hoy });
}

test('toda skill de .claude/skills/ tiene la forma de base/skill.md', () => {
  const carpetas = carpetasDeSkills(RAIZ);
  assert.ok(carpetas.length > 0, 'no hay ninguna skill que comprobar');
  for (const c of carpetas) {
    // Sin reloj: «hoy» es la propia fecha de la skill, así no queda en el futuro.
    const hoy = leerFrontmatter(readFileSync(path.join(c, 'SKILL.md'), 'utf8'))?.comprobado;
    assert.ok(hoy, `${path.basename(c)}: sin fecha comprobado`);
    assert.deepEqual(comprobarSkill(c, { raiz: RAIZ, hoy }), [], path.basename(c));
  }
});

test('base/skill.md dice los mismos topes que el test', () => {
  const base = readFileSync(path.join(RAIZ, 'base', 'skill.md'), 'utf8');
  assert.match(base, new RegExp(`${MAX_LINEAS} líneas`));
  assert.match(base, new RegExp(`${REVISAR_DIAS} días`));
});

test('una skill bien hecha no tiene faltas', () => {
  assert.deepEqual(skill(BIEN), []);
  assert.deepEqual(skill(BIEN.replace('Causa: x.', 'Causa: x.\n') + '\nVer `referencias/a.md`.\n', { 'referencias/a.md': 'x' }), []);
});

test('cada regla de la forma se ve fallar', () => {
  const casos = [
    ['sin Úsala', BIEN.replace('Úsala', 'Sirve'), /cuándo usarla/],
    ['sin No para', BIEN.replace('No para:', 'Salvo'), /cuándo no/],
    ['dueño que no existe', BIEN.replace('constructor', 'fantasma'), /dueño/],
    ['campo de más', BIEN.replace('dueño:', 'tipo: x\ndueño:'), /campos del frontmatter/],
    ['nombre distinto', BIEN.replace('name: prueba', 'name: otra'), /no es el de la carpeta/],
    ['fecha futura', BIEN.replace('2026-10-01', '2026-11-01'), /futuro/],
    ['fecha rota', BIEN.replace('2026-10-01', 'ayer'), /fecha AAAA/],
    ['demasiado larga', `${BIEN}${'línea\n'.repeat(MAX_LINEAS)}`, /líneas/],
    ['sin Lo que falló', BIEN.replace('## Lo que falló', '## Otra cosa'), /falta la sección/],
    ['Lo que falló vacío', BIEN.replace(/- \*\*2026.*\n/, ''), /ninguna lección/],
    ['una IP', `${BIEN}\nentra por 100.64.1.2\n`, /dirección IP/],
    ['una clave privada', `${BIEN}\n-----BEGIN RSA PRIVATE KEY-----\n`, /clave privada/],
    ['un token', `${BIEN}\nghp_abcdefghijkl1234\n`, /token/],
    ['sin frontmatter', '# nada\n', /frontmatter/],
  ];
  for (const [nombre, texto, esperado] of casos) {
    assert.match(skill(texto).join('\n'), esperado, nombre);
  }
});

test('una fecha antigua no es una falta: la skill no caduca, solo se lista como vieja', () => {
  assert.deepEqual(skill(BIEN, {}, '2030-01-01'), []);
});

// Una raíz temporal con una skill de mentira por cada fecha dada (fechas fijas, ninguna del repo).
function raizConSkills(fechas) {
  const raiz = mkdtempSync(path.join(tmpdir(), 'forja-'));
  fechas.forEach((fecha, n) => {
    const carpeta = path.join(raiz, '.claude', 'skills', `s${n}`);
    mkdirSync(carpeta, { recursive: true });
    writeFileSync(path.join(carpeta, 'SKILL.md'), BIEN.replace('name: prueba', `name: s${n}`).replace('2026-10-01', fecha));
  });
  return raiz;
}

test('skillsViejas lista las de más de REVISAR_DIAS días y no las de justo ese plazo', () => {
  const raiz = raizConSkills(['2026-10-15', '2026-12-01']);
  assert.deepEqual(skillsViejas(raiz, '2027-02-01'), [{ nombre: 's0', comprobado: '2026-10-15', dias: 109 }]);
  assert.deepEqual(skillsViejas(raiz, '2027-01-13'), []);
  assert.equal(skillsViejas(raiz, '2027-01-14').length, 1);
});

test('una fecha con formato válido pero imposible se rechaza igual en comprobarSkill y en skillsViejas', () => {
  const rota = BIEN.replace('2026-10-01', '2026-13-45');
  assert.match(skill(rota).join('\n'), /fecha AAAA/);
  assert.throws(() => skillsViejas(raizConSkills(['2026-13-45']), '2027-02-01'), /sin fecha/);
});

test('skillsViejas lanza si no puede leer las skills, no dice que no hay ninguna', () => {
  const vacia = mkdtempSync(path.join(tmpdir(), 'forja-'));
  assert.throws(() => skillsViejas(vacia, '2027-02-01'), /no existe/);
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'stale-skills.mjs'), vacia], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stdout, /ninguna/);
});

test('una referencia que SKILL.md no cita es huérfana, y una carpeta ajena sobra', () => {
  assert.match(skill(BIEN, { 'referencias/huerfana.md': 'x' }).join('\n'), /huérfana/);
  assert.match(skill(BIEN, { 'casos.json': '[]' }).join('\n'), /sobra «casos.json»/);
});

test('skillsViejas lanza si una skill tiene comprobado en el futuro', () => {
  assert.throws(() => skillsViejas(raizConSkills(['2027-03-01']), '2027-02-01'), /en el futuro/);
});

// Trinquete de viñetas sin lección (rules-without-reader.json).
const VINETA = (extra = '') => `- **2026-10-01 · algo.** Causa: x. Arreglo: y.${extra}\n`;
const LECCION = (signal) => JSON.stringify({ v: 2, signal });

// Una raíz temporal con la skill `prueba` (viñetas dadas), lecciones {id: signal} y el presupuesto dado.
function raizDeReglas({ vinetas, lecciones = {}, presupuesto = { prueba: 1 }, fichero = true }) {
  const raiz = mkdtempSync(path.join(tmpdir(), 'trinquete-'));
  const carpeta = path.join(raiz, '.claude', 'skills', 'prueba');
  mkdirSync(carpeta, { recursive: true });
  writeFileSync(path.join(carpeta, 'SKILL.md'), BIEN.replace(/- \*\*2026.*\n/, vinetas.join('')));
  mkdirSync(path.join(raiz, 'lessons'));
  for (const [id, signal] of Object.entries(lecciones)) writeFileSync(path.join(raiz, 'lessons', `${id}.json`), LECCION(signal));
  if (fichero) writeFileSync(path.join(raiz, RULES_BUDGET_FILE), JSON.stringify({ version: 1, budget: presupuesto }));
  return raiz;
}
const codigos = (raiz) => faltasDeReglasSinLector(raiz).map((f) => f.code);

test('las skills reales cumplen el trinquete: las viñetas sin lección son justo las del presupuesto', () => {
  assert.deepEqual(faltasDeReglasSinLector(RAIZ), []);
});

test('el trinquete en verde, y cada fallo nuevo tiene su caso malo', () => {
  assert.deepEqual(codigos(raizDeReglas({ vinetas: [VINETA()] })), []);
  // Una viñeta que enlaza una lección con signal none sigue siendo la memoria: no cuenta ni sobra.
  assert.deepEqual(codigos(raizDeReglas({ vinetas: [VINETA(' Ver `lessons/uno.json`.'), VINETA()], lecciones: { uno: 'none' } })), []);
  assert.deepEqual(codigos(raizDeReglas({ vinetas: [VINETA(), VINETA()], presupuesto: { prueba: 1 } })), [SKILL_FAULTS.BUDGET_EXCEEDED]);
  assert.deepEqual(codigos(raizDeReglas({ vinetas: [VINETA()], presupuesto: { prueba: 2 } })), [SKILL_FAULTS.BUDGET_NOT_LOWERED]);
  assert.deepEqual(codigos(raizDeReglas({ vinetas: [VINETA()], presupuesto: {} })), [SKILL_FAULTS.BUDGET_MISSING]);
  assert.deepEqual(codigos(raizDeReglas({ vinetas: [VINETA()], presupuesto: { prueba: 1, fantasma: 3 } })), [SKILL_FAULTS.BUDGET_UNKNOWN_SKILL]);
  assert.deepEqual(codigos(raizDeReglas({ vinetas: [VINETA(' Ver `lessons/nada.json`.'), VINETA()] })), [SKILL_FAULTS.UNKNOWN_LESSON_LINK]);
  const duplica = raizDeReglas({ vinetas: [VINETA(' Ver `lessons/uno.json`.')], lecciones: { uno: SIGNAL_MACHINE }, presupuesto: { prueba: 0 } });
  assert.deepEqual(codigos(duplica), [SKILL_FAULTS.PROSE_DUPLICATES_TEST]);
});

test('una viñeta de varias líneas cuenta una vez y su enlace puede estar en cualquiera', () => {
  const larga = '- **2026-10-01 · algo.** Causa: x.\n  Arreglo: y. Ver `lessons/uno.json`.\n';
  assert.deepEqual(codigos(raizDeReglas({ vinetas: [larga], lecciones: { uno: 'none' }, presupuesto: { prueba: 0 } })), []);
});

test('el presupuesto que no se puede leer lanza: no se toma como «sin presupuesto»', () => {
  assert.throws(() => faltasDeReglasSinLector(raizDeReglas({ vinetas: [VINETA()], fichero: false })), /no existe/);
  const rota = raizDeReglas({ vinetas: [VINETA()] });
  writeFileSync(path.join(rota, RULES_BUDGET_FILE), '{no');
  assert.throws(() => faltasDeReglasSinLector(rota), /JSON legible/);
  writeFileSync(path.join(rota, RULES_BUDGET_FILE), '{}');
  assert.throws(() => faltasDeReglasSinLector(rota), /«budget»/);
});

test('el trinquete vive en la raíz y no dentro de lessons/, que se lee entera como lecciones', () => {
  assert.equal(RULES_BUDGET_FILE.includes('/'), false);
  assert.equal(existsSync(path.join(RAIZ, RULES_BUDGET_FILE)), true);
  assert.equal(existsSync(path.join(RAIZ, 'lessons', RULES_BUDGET_FILE)), false);
});

test('base/skill.md explica el trinquete y enlaza el fichero, sin copiar sus números', () => {
  const base = readFileSync(path.join(RAIZ, 'base', 'skill.md'), 'utf8');
  assert.ok(base.includes(RULES_BUDGET_FILE));
  assert.ok(base.includes('lessons/<id>.json'));
});

test('la entidad «regla» nombra cada fuente de reglas con su lector, y los lectores existen', () => {
  const regla = readEntities(RAIZ).entities.find((e) => e.id === 'rule');
  assert.deepEqual(regla.rule_sources.map((s) => s.kind), ['lección', 'pregunta', 'viñeta', 'principio']);
  for (const s of regla.rule_sources) {
    assert.ok(s.reader && s.reader_path, s.kind);
    assert.ok(existsSync(path.join(RAIZ, s.reader_path)), `${s.kind}: ${s.reader_path} no existe`);
    assert.ok(regla.readers.includes(s.reader_path), `${s.kind}: ${s.reader_path} no está en readers`);
  }
  const principio = regla.rule_sources.find((s) => s.kind === 'principio');
  assert.match(principio.reader_note, /palabras clave/);
});
