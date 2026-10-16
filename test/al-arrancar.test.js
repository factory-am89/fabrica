// El arranque de sesión: un solo gancho en settings.json; los fallos van por el canal que Claude Code enseña.
// En un SessionStart, stdout solo llega a la sesión con salida 0; con otra salida solo se ve stderr.
// Por eso un fallo se escribe a stderr y se sale con 1; sin fallos, stdout y 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arrancar, pasoLimpiar, PASOS } from '../scripts/al-arrancar.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'al-arrancar.mjs');
const ajustes = JSON.parse(readFileSync(new URL('../.claude/settings.json', import.meta.url), 'utf8'));
const canales = () => {
  const c = { salida: [], error: [] };
  return { c, io: { salida: (l) => c.salida.push(l), error: (l) => c.error.push(l) } };
};

test('al-arrancar: un paso que falla va a stderr, no impide los demás y da 1', () => {
  const { c, io } = canales();
  const pasos = [
    { nombre: 'uno', ejecutar: () => { throw new Error('roto'); } },
    { nombre: 'dos', ejecutar: (escribir) => escribir('hecho') },
  ];
  assert.equal(arrancar(pasos, io), 1);
  assert.deepEqual(c.salida, ['hecho']);
  assert.match(c.error.join('\n'), /FALLÓ el paso «uno»: roto/);
});

test('al-arrancar: el paso limpiar ejecuta la limpieza y su informe va a stdout si no hay fallos', () => {
  const { c, io } = canales();
  let llamadas = 0;
  const falsa = () => { llamadas += 1; return { ensayo: false, borradas: [{ carpeta: 'C:/x', rama: 'feat/x', remota: true, avisos: [] }], quedan: [], fallos: 0 }; };
  assert.equal(arrancar([pasoLimpiar(falsa)], io), 0);
  assert.equal(llamadas, 1);
  assert.match(c.salida.join('\n'), /limpiar borrada: C:.x/);
  assert.deepEqual(c.error, []);
});

test('al-arrancar: si la limpieza deja cosas sin borrar o lanza, el informe y el fallo van a stderr', () => {
  const sinBorrar = { ensayo: false, borradas: [], quedan: [{ carpeta: 'C:/y', rama: 'feat/y', motivo: 'no pude borrarla: x' }], fallos: 1 };
  const a = canales();
  assert.equal(arrancar([pasoLimpiar(() => sinBorrar)], a.io), 1);
  assert.deepEqual(a.c.salida, []);
  assert.match(a.c.error.join('\n'), /no pude borrarla: x/);
  assert.match(a.c.error.join('\n'), /FALLÓ el paso «limpiar»/);
  const b = canales();
  assert.equal(arrancar([pasoLimpiar(() => { throw new Error('GitHub no responde'); })], b.io), 1);
  assert.match(b.c.error.join('\n'), /FALLÓ el paso «limpiar»: GitHub no responde/);
});

test('al-arrancar: lanzado de verdad fuera de un repo, la limpieza falla por stderr, con salida 1 y stdout vacío', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: mkdtempSync(path.join(tmpdir(), 'arranque-')), encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /FALLÓ el paso «limpiar»/);
});

test('al-arrancar: PASOS lleva la limpieza y settings.json lanza solo este script', () => {
  assert.deepEqual(PASOS.map((p) => p.nombre), ['limpiar']);
  const comandos = ajustes.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command));
  assert.deepEqual(comandos, ['node "$CLAUDE_PROJECT_DIR/scripts/al-arrancar.mjs"']);
});
