// El paso «hora» del arranque y `npm run hora`: hora de Madrid con Node, nunca con `date`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { horaDeMadrid, pasoHora } from '../scripts/madrid-time.mjs';
import { arrancar, PASOS } from '../scripts/al-arrancar.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'madrid-time.mjs');

test('hora: en verano (CEST, UTC+2) es dos horas más que UTC', () => {
  assert.equal(horaDeMadrid(new Date('2026-07-15T10:30:00Z')), '15/7/2026, 12:30:00');
});

test('hora: en invierno (CET, UTC+1) es una hora más que UTC', () => {
  assert.equal(horaDeMadrid(new Date('2026-01-15T10:30:00Z')), '15/1/2026, 11:30:00');
});

test('hora: el paso del arranque imprime la hora de Madrid con el reloj inyectado', () => {
  const lineas = [];
  assert.equal(arrancar([pasoHora(() => new Date('2026-10-16T09:05:00Z'))], (l) => lineas.push(l)), 0);
  assert.deepEqual(lineas, ['Hora local de Pablo (Madrid): 16/10/2026, 11:05:00']);
});

test('hora: PASOS la incluye y package.json tiene `npm run hora`', () => {
  assert.ok(PASOS.some((p) => p.nombre === 'hora'));
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.hora, 'node scripts/madrid-time.mjs');
});

test('hora: lanzado de verdad imprime una sola línea con la hora de Madrid y sale 0', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^Hora local de Pablo \(Madrid\): \d+\/\d+\/\d{4}, \d{1,2}:\d{2}:\d{2}\r?\n$/);
});
