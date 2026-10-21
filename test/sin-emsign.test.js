// Node sin raíces emSign (scripts/sin-emsign.mjs y usuario/tls/sin-emsign.cjs): la precarga las quita en un proceso
// real, el paso «tls» del arranque lo comprueba y `instalar` solo añade la opción a NODE_OPTIONS una vez.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { arrancar } from '../scripts/al-arrancar.mjs';
import { instalar, nuevoValor, OPCION, pasoTls, raicesEmSign } from '../scripts/sin-emsign.mjs';

const PRECARGA = fileURLToPath(new URL('../usuario/tls/sin-emsign.cjs', import.meta.url));
const SIN_EMSIGN = fileURLToPath(new URL('../scripts/sin-emsign.mjs', import.meta.url));
// Un proceso Node limpio (sin la NODE_OPTIONS del PC), con o sin la precarga.
const node = (args, conPrecarga) => spawnSync(process.execPath, [...(conPrecarga ? ['--require', PRECARGA] : []), ...args], {
  encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' },
});
const CUENTA = 'const t=require("node:tls");const {X509Certificate:X}=require("node:crypto");const d=t.getCACertificates("default");console.log(d.length, d.filter(c=>/emSign/.test(new X(c).subject)).length)';
const contar = (conPrecarga) => {
  const r = node(['-e', CUENTA], conPrecarga);
  assert.equal(r.status, 0, r.stderr);
  const [total, emSign] = r.stdout.trim().split(' ').map(Number);
  return { total, emSign };
};

// Lo que depende del Node que corre la suite se salta, y lo dice, en vez de ponerse rojo: uno anterior a 22.19 / 24.5 no
// sabe cambiar la lista (la precarga lanza, a propósito) y uno con el parche ya no trae raíces emSign (la precarga sobra).
const SIN_API = typeof tls.setDefaultCACertificates !== 'function';
const saltar = SIN_API
  ? `Node ${process.version} no tiene tls.setDefaultCACertificates`
  : contar(false).emSign === 0 ? `Node ${process.version} ya no trae raíces emSign: la precarga sobra aquí` : false;

test('sin-emsign: sin la precarga este Node trae raíces emSign; con ella, ninguna y el resto intactas', { skip: saltar }, () => {
  const sin = contar(false);
  const con = contar(true);
  assert.ok(sin.emSign > 0);
  assert.equal(con.emSign, 0);
  assert.equal(con.total, sin.total - sin.emSign);
});

test('sin-emsign: el paso «tls» falla en alto sin la precarga y pasa con ella, por la entrada real', { skip: saltar }, () => {
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

test('sin-emsign: raicesEmSign no cuenta nada en la lista que deja la precarga', { skip: SIN_API && saltar }, () => {
  const filtrada = node(['-e', 'console.log(JSON.stringify(require("node:tls").getCACertificates("default")))'], true);
  assert.deepEqual(raicesEmSign(JSON.parse(filtrada.stdout)), []);
});

test('sin-emsign: NODE_OPTIONS se completa sin repetir ni borrar lo que había, y una ruta con espacios es un error', () => {
  const p = 'C:\\Users\\x\\.claude\\tls\\sin-emsign.cjs';
  assert.equal(nuevoValor('', p), OPCION(p));
  assert.equal(nuevoValor('--max-old-space-size=4096', p), `--max-old-space-size=4096 ${OPCION(p)}`);
  assert.equal(nuevoValor(`--x ${OPCION(p)}`, p), null);
  assert.throws(() => nuevoValor('', 'C:\\Users\\Ana María\\x.cjs'), /espacios/);
});

// Un NODE_OPTIONS de usuario de mentira: leer devuelve lo último escrito.
function registro(inicial) {
  const r = { valor: inicial, escritos: [] };
  r.leer = () => r.valor;
  r.escribir = (v) => { r.escritos.push(v); r.valor = v; };
  return r;
}

test('sin-emsign: instalar añade la opción a lo que había, una sola vez, y comprueba que quedó guardada', () => {
  const reg = registro('--max-old-space-size=4096');
  assert.match(instalar({ precarga: PRECARGA, plataforma: 'win32', leer: reg.leer, escribir: reg.escribir }), /NODE_OPTIONS=--max-old-space-size=4096 --require/);
  assert.deepEqual(reg.escritos, [`--max-old-space-size=4096 ${OPCION(PRECARGA)}`]);
  assert.match(instalar({ precarga: PRECARGA, plataforma: 'win32', leer: reg.leer, escribir: reg.escribir }), /ya carga/);
  assert.equal(reg.escritos.length, 1);
  const sorda = registro('');
  assert.throws(() => instalar({ precarga: PRECARGA, plataforma: 'win32', leer: sorda.leer, escribir: () => {} }), /no quedó guardada/);
});

test('sin-emsign: si leer NODE_OPTIONS falla, instalar lanza y no escribe nada (no pisa lo que hubiera)', () => {
  const escritos = [];
  const leer = () => { throw new Error('no pude leer NODE_OPTIONS del usuario: acceso denegado'); };
  assert.throws(() => instalar({ precarga: PRECARGA, plataforma: 'win32', leer, escribir: (v) => escritos.push(v) }), /acceso denegado/);
  assert.deepEqual(escritos, []);
});

test('sin-emsign: instalar falla sin el fichero instalado, fuera de Windows o si la escritura falla', () => {
  const reg = registro('');
  assert.throws(() => instalar({ precarga: `${PRECARGA}.no`, plataforma: 'win32', leer: reg.leer, escribir: reg.escribir }), /install-pc/);
  assert.throws(() => instalar({ precarga: PRECARGA, plataforma: 'linux', leer: reg.leer, escribir: reg.escribir }), /Windows/);
  const rota = () => { throw new Error('no pude guardar NODE_OPTIONS del usuario: no'); };
  assert.throws(() => instalar({ precarga: PRECARGA, plataforma: 'win32', leer: reg.leer, escribir: rota }), /no pude guardar/);
  assert.deepEqual(reg.escritos, []);
});
