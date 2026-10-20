// El arranque de sesión: un solo gancho en settings.json; todo, fallos incluidos, por stdout y con salida 0
// (en SessionStart, Claude Code da el stdout a la sesión; ver el comentario de scripts/al-arrancar.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arrancar, leerArgumentos, pasoLimpiar, PASOS, SOLO } from '../scripts/al-arrancar.mjs';
import { ExitError, EXIT } from '../scripts/lib/exit.mjs';
import { STEP_NAME } from '../scripts/lib/periodic.mjs';
import { SNAPSHOT_FILE } from '../scripts/lib/periodic-state.mjs';
import { casaDeAudit } from './apoyo/audit-casa.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'al-arrancar.mjs');
const ajustes = JSON.parse(readFileSync(new URL('../.claude/settings.json', import.meta.url), 'utf8'));
const recoger = () => {
  const lineas = [];
  return { lineas, escribir: (l) => lineas.push(l) };
};

test('al-arrancar: un paso que falla abre el informe con un titular inequívoco y no impide los demás', () => {
  const { lineas, escribir } = recoger();
  const pasos = [
    { nombre: 'uno', ejecutar: (e) => { e('detalle de uno'); throw new Error('roto'); } },
    { nombre: 'dos', ejecutar: (e) => e('hecho') },
  ];
  assert.equal(arrancar(pasos, escribir), 1);
  assert.match(lineas[0], /^FÁBRICA AL ARRANCAR: FALLÓ el paso «uno»: roto\. Díselo a Pablo y no sigas como si nada\.$/);
  assert.deepEqual(lineas.slice(1), ['detalle de uno', 'hecho']);
});

test('al-arrancar: el paso limpiar ejecuta la limpieza y, sin fallos, solo cuenta lo hecho', () => {
  const { lineas, escribir } = recoger();
  let llamadas = 0;
  const falsa = () => { llamadas += 1; return { ensayo: false, borradas: [{ carpeta: 'C:/x', rama: 'feat/x', remota: true, avisos: [] }], quedan: [], fallos: 0 }; };
  assert.equal(arrancar([pasoLimpiar(falsa)], escribir), 0);
  assert.equal(llamadas, 1);
  assert.match(lineas.join(' | '), /limpiar borrada: C:.x/);
  assert.doesNotMatch(lineas.join(' | '), /FALLÓ/);
});

test('al-arrancar: si la limpieza deja cosas sin borrar o lanza, el titular va primero y el detalle después', () => {
  const sinBorrar = { ensayo: false, borradas: [], quedan: [{ carpeta: 'C:/y', rama: 'feat/y', motivo: 'no pude borrarla: x' }], fallos: 1 };
  const a = recoger();
  assert.equal(arrancar([pasoLimpiar(() => sinBorrar)], a.escribir), 1);
  assert.match(a.lineas[0], /^FÁBRICA AL ARRANCAR: FALLÓ el paso «limpiar»/);
  assert.match(a.lineas.join(' | '), /no pude borrarla: x/);
  const b = recoger();
  assert.equal(arrancar([pasoLimpiar(() => { throw new Error('GitHub no responde'); })], b.escribir), 1);
  assert.match(b.lineas[0], /FALLÓ el paso «limpiar»: GitHub no responde/);
});

test('al-arrancar: lanzado de verdad fuera de un repo, el fallo sale por stdout, primera línea inequívoca, salida 0', (t) => {
  // HOME de usar y tirar: el paso periodico apunta su medida en ~/.fabrica.
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: mkdtempSync(path.join(tmpdir(), 'arranque-')), encoding: 'utf8', env: casaDeAudit(t).env });
  assert.equal(r.status, 0);
  const lineas = r.stdout.split(/\r?\n/);
  assert.match(lineas[0], /^FÁBRICA AL ARRANCAR: FALLÓ el paso «al-dia»/);
  assert.match(lineas[1], /^FÁBRICA AL ARRANCAR: FALLÓ el paso «limpiar»/);
  assert.equal(r.stderr, '');
});

test('al-arrancar: PASOS lleva la limpieza y settings.json lanza solo este script', () => {
  assert.deepEqual(PASOS.map((p) => p.nombre), ['al-dia', 'limpiar', 'sesiones', STEP_NAME, 'hora']);
  const comandos = ajustes.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command));
  assert.deepEqual(comandos, ['node "$CLAUDE_PROJECT_DIR/scripts/al-arrancar.mjs"']);
});

const NOMBRES = PASOS.map((p) => p.nombre);
const uso = (argv, motivo) => assert.throws(() => leerArgumentos(argv), (e) => e instanceof ExitError && e.key === 'USAGE' && motivo.test(e.message), JSON.stringify(argv));

test('al-arrancar: leerArgumentos acepta nada o --solo <paso> y rechaza cualquier otra cosa con un error de uso', () => {
  assert.deepEqual(leerArgumentos([]), { solo: null });
  for (const nombre of NOMBRES) assert.deepEqual(leerArgumentos([SOLO, nombre]), { solo: nombre });
  uso([SOLO], /^uso: al-arrancar\.mjs \[--solo <paso>\]; recibí \["--solo"\]$/);
  uso([SOLO, STEP_NAME, 'sobra'], /recibí/);
  uso(['--otra', STEP_NAME], /recibí/);
  uso([SOLO, 'inventado'], new RegExp(`no existe el paso «inventado»; los pasos son ${NOMBRES.join(', ')}$`));
  assert.deepEqual(leerArgumentos([SOLO, 'b'], [{ nombre: 'a' }, { nombre: 'b' }]), { solo: 'b' });
});

test('al-arrancar --solo periodico, por la entrada real: corre solo ese paso, apunta su medida en el HOME y la segunda vez dice que nada cambió', (t) => {
  const casa = casaDeAudit(t);
  const lanzar = (...argv) => spawnSync(process.execPath, [SCRIPT, ...argv], { cwd: mkdtempSync(path.join(tmpdir(), 'arranque-')), encoding: 'utf8', env: casa.env });
  const a = lanzar(SOLO, STEP_NAME);
  assert.equal(a.status, EXIT.OK, a.stderr);
  const lineas = a.stdout.trimEnd().split(/\r?\n/);
  assert.ok(lineas.every((l) => l.startsWith(`${STEP_NAME}: `)), a.stdout);
  assert.match(lineas[0], /^periodico: \d+ indicadores locales medidos \(sin red\); higiene: \d+ candidatos$/);
  assert.equal(lineas[1], 'periodico: primera medida en este PC; no hay medida anterior con la que comparar');
  assert.deepEqual(readdirSync(path.dirname(casa.file)), [SNAPSHOT_FILE]);
  const b = lanzar(SOLO, STEP_NAME);
  assert.match(b.stdout.split(/\r?\n/)[1], /^periodico: nada cambió desde la medida anterior \(\d{4}-/);
  const hora = lanzar(SOLO, 'hora');
  assert.equal(hora.status, EXIT.OK, hora.stderr);
  assert.equal(hora.stdout.trimEnd().split(/\r?\n/).length, 1, 'ni al-dia, ni limpiar, ni periodico');
});

test('al-arrancar --solo con un uso malo: nada por stdout, el motivo por stderr y la salida de USAGE', (t) => {
  const casa = casaDeAudit(t);
  for (const argv of [[SOLO], [SOLO, 'inventado'], ['--otra']]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...argv], { encoding: 'utf8', env: casa.env });
    assert.equal(r.status, EXIT.USAGE, JSON.stringify(argv));
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /uso: al-arrancar\.mjs|no existe el paso «inventado»/);
  }
});
