// La identidad la elige la persona: FABRICA_IDENTIDAD (identidadActiva en scripts/lib/identities.mjs) frente a la de la
// ficha, y la App, el documento y la caja que token.mjs saca de ella. Lo de dentro del proceso usa entornos escritos aquí;
// la entrada real es `node scripts/token.mjs -- ...` con el `op` falso de test/apoyo/precarga-falsa.mjs (sin red ni `op`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { IDENTIDADES, VARIABLE_IDENTIDAD, identidadActiva } from '../scripts/lib/identities.mjs';
import { leerFicha } from '../scripts/lib/repo-card.mjs';
import { REPO, OWNER_LOGIN } from '../scripts/lib/repo.mjs';
import { IDENTIDAD_POR_DEFECTO, clientId, identidadDelToken, MOTIVOS } from '../scripts/token.mjs';

const CONSTRUCTOR = 'fabrica-constructor';
const AJENO = 'otro-dueno/r';
const con = (nombre) => ({ [VARIABLE_IDENTIDAD]: nombre });

test('sin la variable vale la de la ficha, como siempre', () => {
  const a = identidadActiva({}, { repo: REPO, identidad: CONSTRUCTOR });
  assert.equal(a.nombre, CONSTRUCTOR);
  assert.equal(a.origen, 'ficha');
  assert.equal(a.lanzador, IDENTIDADES[CONSTRUCTOR].lanzador);
  assert.equal(identidadActiva({}, { repo: AJENO, identidad: 'ninguna' }).nombre, 'ninguna');
});

test('con la variable manda la de la persona, si vale en el dueño del repo', () => {
  const a = identidadActiva(con(` ${CONSTRUCTOR} `), { repo: REPO, identidad: 'ninguna' });
  assert.equal(a.nombre, CONSTRUCTOR);
  assert.equal(a.origen, VARIABLE_IDENTIDAD);
  assert.equal(identidadActiva(con('ninguna'), { repo: REPO, identidad: CONSTRUCTOR }).nombre, 'ninguna');
});

test('falla en alto: identidad que no existe, que no vale en ese dueño, o variable vacía; nunca cae a la de la ficha', () => {
  const ficha = { repo: AJENO, identidad: 'ninguna' };
  assert.throws(() => identidadActiva(con('no-existe'), ficha), /Identidad desconocida: no-existe/);
  assert.throws(() => identidadActiva(con(CONSTRUCTOR), ficha), new RegExp(`${VARIABLE_IDENTIDAD}=${CONSTRUCTOR}: la identidad ${CONSTRUCTOR} solo vale en repos de`));
  assert.throws(() => identidadActiva(con('  '), ficha), new RegExp(`${VARIABLE_IDENTIDAD} está puesta pero vacía`));
  assert.throws(() => identidadActiva({}, { repo: AJENO, identidad: CONSTRUCTOR }), /La ficha de otro-dueno\/r: la identidad fabrica-constructor solo vale/, 'la de la ficha también se valida');
});

test('leerFicha devuelve la identidad activa: la de la ficha, o la de la variable', () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'identidad-')));
  try {
    writeFileSync(path.join(dir, '.fabrica.json'), JSON.stringify({ repo: `${OWNER_LOGIN}/MenuPlan`, base: 'staging', identidad: CONSTRUCTOR }));
    assert.equal(leerFicha(dir, undefined, {}).identidad, CONSTRUCTOR);
    assert.equal(leerFicha(dir, undefined, con('ninguna')).identidad, 'ninguna');
    assert.throws(() => leerFicha(dir, undefined, con('no-existe')), /Identidad desconocida/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cada identidad con lanzador token.mjs trae su App: client id, documento y caja; la de solo lectura no tiene', () => {
  const token = fileURLToPath(new URL('../scripts/token.mjs', import.meta.url));
  for (const [nombre, { lanzador, app }] of Object.entries(IDENTIDADES)) {
    if (lanzador !== token) { assert.equal(app, null, nombre); continue; }
    assert.match(app.clientId, /^Iv23li[A-Za-z0-9]+$/, nombre);
    assert.match(app.documento, /\.pem$/, nombre);
    assert.ok(typeof app.boveda === 'string' && app.boveda.trim(), nombre);
  }
  assert.equal(IDENTIDADES[IDENTIDAD_POR_DEFECTO].lanzador, token, 'la identidad por defecto de token.mjs es una que lanza token.mjs');
});

// El documento y la caja que pide clavePrivada se prueban en test/token-cache.test.js (la lista de PUERTAS de op-door.mjs).
test('token.mjs: el client id sale de la identidad activa', () => {
  const { app } = IDENTIDADES[CONSTRUCTOR];
  assert.equal(identidadDelToken({}).nombre, CONSTRUCTOR);
  assert.equal(clientId({}), app.clientId);
  assert.equal(clientId(con(CONSTRUCTOR)), app.clientId);
});

test('token.mjs: una identidad sin App, o fuera de su dueño, falla al elegirla', () => {
  assert.throws(() => identidadDelToken(con('ninguna')), /La identidad ninguna \(FABRICA_IDENTIDAD\) no tiene App/);
  assert.throws(() => identidadDelToken({ ...con(CONSTRUCTOR), FABRICA_REPO: AJENO }), /token\.mjs: la identidad fabrica-constructor solo vale en repos de/);
  assert.throws(() => clientId({ ...con('ninguna'), FABRICA_CONSTRUCTOR_CLIENT_ID: 'Iv23otro' }), /no tiene App/);
});

// Entrada real: el proceso de token.mjs con el `op` falso. `op` responde con un fallo, así que si se llega a leer sale
// sin-clave y el contador tiene una línea; si la identidad falla antes, sale con 1 y el contador sigue vacío.
function correr(extra) {
  const casa = mkdtempSync(path.join(tmpdir(), 'fabrica-identidad-'));
  const contador = path.join(casa, 'contador.txt');
  writeFileSync(contador, '');
  mkdirSync(path.join(casa, 'AppData', 'Local'), { recursive: true });
  const env = {
    ...process.env, USERPROFILE: casa, HOME: casa, LOCALAPPDATA: path.join(casa, 'AppData', 'Local'),
    OP_SERVICE_ACCOUNT_TOKEN: 'ops_fake', FALSO_CONTADOR: contador, FALSO_STDERR: 'no such item', ...extra,
  };
  for (const k of ['FABRICA_REPO', 'FABRICA_CONSTRUCTOR_CLIENT_ID', VARIABLE_IDENTIDAD]) if (!(k in extra)) delete env[k];
  try {
    const precarga = pathToFileURL(fileURLToPath(new URL('./apoyo/precarga-falsa.mjs', import.meta.url))).href;
    const r = spawnSync(process.execPath, ['--import', precarga, fileURLToPath(new URL('../scripts/token.mjs', import.meta.url)), '--', process.execPath, '-e', 'process.exit(0)'], { env, encoding: 'utf8' });
    return { status: r.status, stderr: r.stderr, lecturas: readFileSync(contador, 'utf8').split('\n').filter(Boolean).length };
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
}

test('token.mjs de verdad: FABRICA_IDENTIDAD elige; una que no existe, sin App o fuera de su dueño sale con 1 sin leer 1Password', () => {
  const elegida = correr(con(CONSTRUCTOR));
  assert.deepEqual([elegida.status, elegida.lecturas], [MOTIVOS['sin-clave'], 1], elegida.stderr);
  assert.match(elegida.stderr, new RegExp(`No pude leer ${IDENTIDADES[CONSTRUCTOR].app.documento} de 1Password \\(bóveda ${IDENTIDADES[CONSTRUCTOR].app.boveda}\\)`));
  for (const [extra, motivo] of [
    [con('no-existe'), /Identidad desconocida: no-existe/],
    [con('ninguna'), /no tiene App/],
    [{ ...con(CONSTRUCTOR), FABRICA_REPO: AJENO }, /solo vale en repos de/],
  ]) {
    const r = correr(extra);
    assert.deepEqual([r.status, r.lecturas], [1, 0], `${JSON.stringify(extra)}: ${r.stderr}`);
    assert.match(r.stderr, motivo);
  }
});

// The test files that failed when the whole suite ran with FABRICA_IDENTIDAD=ninguna (2026-10-30, 11 tests in these 7 files):
// they reach leerFicha or token.mjs through process.env, so they import test/apoyo/sin-identidad.mjs. This only catches one
// of them losing the import; a new file of the same kind is caught by running the suite with the variable set, as that day.
const DEPENDEN_DEL_ENTORNO = ['clean', 'identidades-dueno', 'presupuesto-lecturas', 'proyecto-nuevo', 'tarea-ficha', 'token-lecturas', 'token-salida'];

test('los tests que leen la identidad de process.env no dependen de la del PC: importan sin-identidad.mjs', () => {
  for (const n of DEPENDEN_DEL_ENTORNO) {
    const src = readFileSync(new URL(`./${n}.test.js`, import.meta.url), 'utf8');
    assert.match(src, /^import '\.\/apoyo\/sin-identidad\.mjs';/m, `test/${n}.test.js`);
  }
});
