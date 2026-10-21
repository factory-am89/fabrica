// Node sin raíces emSign (scripts/sin-emsign.mjs y usuario/tls/sin-emsign.cjs): la precarga las quita en un proceso
// real, el paso «tls» del arranque lo comprueba y `instalar` solo añade la opción a NODE_OPTIONS una vez.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { arrancar } from '../scripts/al-arrancar.mjs';
import { instalar, nuevoValor, OPCION, pasoTls, raicesEmSign } from '../scripts/sin-emsign.mjs';

const PRECARGA = fileURLToPath(new URL('../usuario/tls/sin-emsign.cjs', import.meta.url));
const SIN_EMSIGN = fileURLToPath(new URL('../scripts/sin-emsign.mjs', import.meta.url));
// Un proceso Node limpio (sin la NODE_OPTIONS del PC), con o sin la precarga.
const node = (args, conPrecarga) => spawnSync(process.execPath, [...(conPrecarga ? ['--require', PRECARGA] : []), ...args], {
  encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' },
});

test('sin-emsign: sin la precarga este Node trae raíces emSign; con ella, ninguna y el resto intactas', (t) => {
  const cuenta = 'const t=require("node:tls");const {X509Certificate:X}=require("node:crypto");const d=t.getCACertificates("default");console.log(d.length, d.filter(c=>/emSign/.test(new X(c).subject)).length)';
  const [totalSin, emSin] = node(['-e', cuenta], false).stdout.trim().split(' ').map(Number);
  // Un Node con el parche ya no las trae: se dice como saltado (no rojo) y la precarga sobra en ese Node.
  if (emSin === 0) return t.skip(`Node ${process.version} ya no trae raíces emSign: la precarga sobra aquí`);
  const r = node(['-e', cuenta], true);
  assert.equal(r.status, 0, r.stderr);
  const [totalCon, emCon] = r.stdout.trim().split(' ').map(Number);
  assert.equal(emCon, 0);
  assert.equal(totalCon, totalSin - emSin);
});

test('sin-emsign: el paso «tls» falla en alto sin la precarga y pasa con ella, por la entrada real', () => {
  const sin = node([SIN_EMSIGN, 'comprobar'], false);
  assert.equal(sin.status, 1);
  assert.match(sin.stderr, /Node confía aún en \d+ raíces emSign/);
  const con = node([SIN_EMSIGN, 'comprobar'], true);
  assert.equal(con.status, 0, con.stderr);
  assert.match(con.stdout, /ninguna raíz emSign/);
});

test('sin-emsign: dentro del arranque, quedar raíces es un titular de fallo del paso «tls»', () => {
  const lineas = [];
  assert.equal(arrancar([pasoTls(() => ['CN=emSign Root CA - G1'])], (l) => lineas.push(l)), 1);
  assert.match(lineas[0], /^FÁBRICA AL ARRANCAR: FALLÓ el paso «tls»: Node confía aún en 1 raíces emSign/);
  assert.equal(arrancar([pasoTls(() => [])], () => {}), 0);
});

test('sin-emsign: raicesEmSign solo cuenta emSign', () => {
  const sinEmSign = node(['-e', 'console.log(JSON.stringify(require("node:tls").getCACertificates("default")))'], true);
  assert.deepEqual(raicesEmSign(JSON.parse(sinEmSign.stdout)), []);
});

test('sin-emsign: NODE_OPTIONS se completa sin repetir ni borrar lo que había, y una ruta con espacios es un error', () => {
  const p = 'C:\\Users\\x\\.claude\\tls\\sin-emsign.cjs';
  assert.equal(nuevoValor('', p), OPCION(p));
  assert.equal(nuevoValor('--max-old-space-size=4096', p), `--max-old-space-size=4096 ${OPCION(p)}`);
  assert.equal(nuevoValor(`--x ${OPCION(p)}`, p), null);
  assert.throws(() => nuevoValor('', 'C:\\Users\\Ana María\\x.cjs'), /espacios/);
});

test('sin-emsign: instalar llama a setx una sola vez, falla sin el fichero instalado, fuera de Windows o si setx falla', () => {
  const llamadas = [];
  const setx = (v) => { llamadas.push(v); return { status: 0 }; };
  assert.match(instalar({ precarga: PRECARGA, plataforma: 'win32', leer: () => '', setx }), /NODE_OPTIONS=--require/);
  assert.deepEqual(llamadas, [OPCION(PRECARGA)]);
  assert.match(instalar({ precarga: PRECARGA, plataforma: 'win32', leer: () => OPCION(PRECARGA), setx }), /ya carga/);
  assert.equal(llamadas.length, 1);
  assert.throws(() => instalar({ precarga: `${PRECARGA}.no`, plataforma: 'win32', leer: () => '', setx }), /install-pc/);
  assert.throws(() => instalar({ precarga: PRECARGA, plataforma: 'linux', leer: () => '', setx }), /Windows/);
  assert.throws(() => instalar({ precarga: PRECARGA, plataforma: 'win32', leer: () => '', setx: () => ({ status: 1, stderr: 'no' }) }), /setx falló: no/);
});
