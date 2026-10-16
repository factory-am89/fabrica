// La forja mínima de skills (base/skill.md): una sola, la misma para cualquier skill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { comprobarSkill, carpetasDeSkills, MAX_LINEAS, CADUCA_DIAS, leerFrontmatter } from '../scripts/lib/skills.mjs';

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
    // Sin reloj: «hoy» es la propia fecha de la skill, así no caduca ni queda en el futuro.
    const hoy = leerFrontmatter(readFileSync(path.join(c, 'SKILL.md'), 'utf8'))?.comprobado;
    assert.ok(hoy, `${path.basename(c)}: sin fecha comprobado`);
    assert.deepEqual(comprobarSkill(c, { raiz: RAIZ, hoy }), [], path.basename(c));
  }
});

test('base/skill.md dice los mismos topes que el test', () => {
  const base = readFileSync(path.join(RAIZ, 'base', 'skill.md'), 'utf8');
  assert.match(base, new RegExp(`${MAX_LINEAS} líneas`));
  assert.match(base, new RegExp(`${CADUCA_DIAS} días`));
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
    ['fecha caducada', BIEN.replace('2026-10-01', '2026-06-01'), /caducó/],
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

test('caduca pasados los 90 días, y a los 90 justos aún vale', () => {
  const vieja = BIEN.replace('2026-10-01', '2026-10-15');
  assert.match(skill(vieja, {}, '2027-02-01').join('\n'), /caducó/);
  assert.deepEqual(skill(vieja, {}, '2027-01-13'), []);
});

test('una referencia que SKILL.md no cita es huérfana, y una carpeta ajena sobra', () => {
  assert.match(skill(BIEN, { 'referencias/huerfana.md': 'x' }).join('\n'), /huérfana/);
  assert.match(skill(BIEN, { 'casos.json': '[]' }).join('\n'), /sobra «casos.json»/);
});
