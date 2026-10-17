// Plantilla con huecos {{nombre}} + fichero de valores: lo que rellena instalar-pc. Todo con valores INVENTADOS
// y un settings de prueba (test/fixtures/settings-base.json): ningún dato real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORIGEN, instalar, confirmarEnTerminal } from '../scripts/install-pc.mjs';
import { huecos, rellenar } from '../scripts/lib/template.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'install-pc.mjs');
const base = () => JSON.parse(readFileSync(path.join(RAIZ, 'test', 'fixtures', 'settings-base.json'), 'utf8'));

// --- la mecánica ---

test('huecos: nombres sin repetir y en orden, dentro de textos, listas y objetos', () => {
  assert.deepEqual(huecos({ a: '{{b}}', c: ['x {{a}} y {{b}}', { d: '{{c.d}}' }], e: 1, f: null }), ['a', 'b', 'c.d']);
  assert.deepEqual(huecos({ a: 'sin huecos' }), []);
});

test('rellenar: un texto que es solo el hueco toma el valor, del tipo que sea, y es una copia', () => {
  const valor = { x: [1, 2] };
  const r = rellenar({ a: '{{n}}' }, { n: valor });
  assert.deepEqual(r, { a: { x: [1, 2] } });
  r.a.x.push(3);
  assert.deepEqual(valor, { x: [1, 2] }, 'el resultado no comparte nada con los valores');
});

test('rellenar: un hueco dentro de un texto exige un valor de texto y no se vuelve a expandir', () => {
  assert.deepEqual(rellenar({ a: 'x {{n}} y' }, { n: 'z' }), { a: 'x z y' });
  assert.throws(() => rellenar({ a: 'x {{n}} y' }, { n: ['z'] }), /no es un texto/);
  assert.deepEqual(rellenar({ a: '{{n}}' }, { n: '{{m}}' }), { a: '{{m}}' });
});

test('rellenar: un hueco sin valor y un valor sin hueco lanzan nombrándolos; los valores no salen en el mensaje', () => {
  assert.throws(() => rellenar({ a: '{{n}}' }, {}), /faltan valores para: n/);
  assert.throws(() => rellenar({ a: 'sin hueco' }, { sobra: 'secreto-de-prueba' }), (e) => /sobran valores sin hueco: sobra/.test(e.message) && !/secreto-de-prueba/.test(e.message));
  assert.throws(() => rellenar({ a: '{{n}}' }, null), /objeto JSON/);
  assert.throws(() => rellenar({ a: '{{n}}' }, [1]), /objeto JSON/);
});

// --- con instalar-pc ---

const VALORES_PRUEBA = {
  home: 'C:/Users/prueba',
  'autoMode.environment': ['Frontera de prueba uno', 'Frontera de prueba dos'],
  enabledPlugins: { 'plugin-de-prueba@mercado': true },
};

// La plantilla de prueba: el settings inventado con tres huecos (uno dentro de un texto, dos enteros).
function plantilla() {
  const s = base();
  s.hooks.SessionStart[0].hooks[0].command = 'node "{{home}}/.claude/hook.mjs" --si';
  s.autoMode.environment = '{{autoMode.environment}}';
  s.enabledPlugins = '{{enabledPlugins}}';
  return s;
}
const esperado = () => rellenar(plantilla(), VALORES_PRUEBA);

function origenConPlantilla(s = plantilla()) {
  const o = mkdtempSync(path.join(tmpdir(), 'usuario-'));
  cpSync(ORIGEN, o, { recursive: true });
  writeFileSync(path.join(o, 'settings.json'), `${JSON.stringify(s, null, 2)}\n`);
  return o;
}
const ficheroValores = (valores = VALORES_PRUEBA) => {
  const f = path.join(mkdtempSync(path.join(tmpdir(), 'valores-')), 'valores.json');
  writeFileSync(f, JSON.stringify(valores));
  return f;
};
const claude = (home, ...r) => path.join(home, '.claude', ...r);
const nuevoHome = () => mkdtempSync(path.join(tmpdir(), 'instalar-pc-'));
const cli = (home, origen, valores, orden = 'instalar', ...extra) =>
  spawnSync('node', [SCRIPT, orden, ...extra], {
    env: { ...process.env, FABRICA_HOME: home, FABRICA_USUARIO: origen, FABRICA_VALORES: valores },
    encoding: 'utf8',
  });
// «Pablo» confirma la primera instalación (es una ampliación) desde una terminal simulada.
const instalarConfirmado = (home, origen, valores = VALORES_PRUEBA) =>
  instalar({ home, origen, valores, confirmar: confirmarEnTerminal({ tty: true, leerLinea: () => 'AMPLIAR', escribir: () => {} }) });

test('valores: el relleno correcto instala exactamente la plantilla rellena, sin huecos, y comprobar coincide', () => {
  const home = nuevoHome();
  const origen = origenConPlantilla();
  instalarConfirmado(home, origen);
  const instalado = readFileSync(claude(home, 'settings.json'), 'utf8');
  assert.equal(instalado, `${JSON.stringify(esperado(), null, 2)}\n`);
  assert.doesNotMatch(instalado, /\{\{/);
  assert.match(instalado, /node \\"C:\/Users\/prueba\/\.claude\/hook\.mjs\\" --si/);
  const r = cli(home, origen, ficheroValores(), 'comprobar');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /coincide/);
});

test('valores: sin fichero de valores, error claro (2) y nada escrito; comprobar también falla con 2', () => {
  const home = nuevoHome();
  const inexistente = path.join(tmpdir(), 'no-existe-valores.json');
  const r = cli(home, origenConPlantilla(), inexistente);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /Falta el fichero de valores privados/);
  assert.equal(existsSync(claude(home)), false);
  const c = cli(home, origenConPlantilla(), inexistente, 'comprobar');
  assert.equal(c.status, 2);
  assert.match(c.stderr, /Falta el fichero de valores privados/);
});

test('valores: un hueco sin valor, error que lo nombra y nada escrito', () => {
  const home = nuevoHome();
  const sinHome = { ...VALORES_PRUEBA };
  delete sinHome.home;
  const r = cli(home, origenConPlantilla(), ficheroValores(sinHome));
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /faltan valores para: home/);
  assert.equal(existsSync(claude(home)), false);
});

test('valores: un valor sobrante, error que lo nombra y nada escrito', () => {
  const home = nuevoHome();
  const r = cli(home, origenConPlantilla(), ficheroValores({ ...VALORES_PRUEBA, sobrante: 'x' }));
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /sobran valores sin hueco: sobrante/);
  assert.equal(existsSync(claude(home)), false);
});

test('valores: un fichero que no es JSON o no es un objeto, error y nada escrito', () => {
  const home = nuevoHome();
  const malo = path.join(mkdtempSync(path.join(tmpdir(), 'valores-')), 'valores.json');
  writeFileSync(malo, '{no es json');
  const a = cli(home, origenConPlantilla(), malo);
  assert.equal(a.status, 2);
  assert.match(a.stderr, /no es un JSON válido/);
  const b = cli(home, origenConPlantilla(), ficheroValores([1, 2]));
  assert.equal(b.status, 2);
  assert.match(b.stderr, /objeto JSON/);
  assert.equal(existsSync(claude(home)), false);
});

test('valores: comprobar compara contra el resultado RELLENO (otro valor, otro resultado)', () => {
  const home = nuevoHome();
  const origen = origenConPlantilla();
  instalarConfirmado(home, origen);
  const r = cli(home, origen, ficheroValores({ ...VALORES_PRUEBA, home: 'C:/Users/otro' }), 'comprobar');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /settings\.json desactualizado/);
});

test('valores: una plantilla sin huecos no necesita fichero de valores', () => {
  const home = nuevoHome();
  const r = cli(home, origenConPlantilla(base()), path.join(tmpdir(), 'no-existe-valores.json'), 'comprobar');
  assert.equal(r.status, 1, 'falta settings.json, pero no por los valores');
  assert.doesNotMatch(r.stderr, /valores/);
});

test('valores: la puerta de ampliación se aplica al resultado RELLENO (una regla allow en un valor)', () => {
  const home = nuevoHome();
  const origen = origenConPlantilla();
  instalarConfirmado(home, origen);
  const nuevos = { ...VALORES_PRUEBA, 'autoMode.environment': [...VALORES_PRUEBA['autoMode.environment'], 'Frontera nueva'] };
  const r = cli(home, origen, ficheroValores(nuevos));
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /autoMode\.environment nuevo: Frontera nueva/);
});
