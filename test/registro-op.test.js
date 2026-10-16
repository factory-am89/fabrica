// Read log of 1Password: injected disk (temp directory) and clock; no real `op`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contarLecturas, registrarLectura, rutaDeRegistro } from '../scripts/lib/registro-op.mjs';
import { clavePrivada, MOTIVOS } from '../scripts/token.mjs';

const PEM = '-----BEGIN RSA PRIVATE KEY-----\nVALOR-SECRETO-DE-PRUEBA\n-----END RSA PRIVATE KEY-----\n';
const AHORA = Date.UTC(2026, 9, 16, 10, 0, 0);

function conRegistro(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'fabrica-registro-'));
  try {
    return fn(join(dir, '.fabrica', 'op-reads.jsonl'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('rutaDeRegistro: ~/.fabrica/op-reads.jsonl', () => {
  assert.equal(rutaDeRegistro(() => '/home/x'), join('/home/x', '.fabrica', 'op-reads.jsonl'));
});

test('registrarLectura: one JSON line with time, script, name and result', () => conRegistro((ruta) => {
  registrarLectura({ script: 'token.mjs', nombre: 'fabrica-constructor.pem', resultado: 'ok', ruta, reloj: () => AHORA });
  registrarLectura({ script: 'token.mjs', nombre: 'fabrica-constructor.pem', resultado: 'limite-de-1password', ruta, reloj: () => AHORA });
  const lineas = readFileSync(ruta, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lineas[0], { t: '2026-10-16T10:00:00.000Z', script: 'token.mjs', leido: 'fabrica-constructor.pem', resultado: 'ok' });
  assert.equal(lineas[1].resultado, 'limite-de-1password');
}));

test('registrarLectura: a value (spaces, newlines, a key) is refused instead of written', () => conRegistro((ruta) => {
  for (const nombre of [PEM, 'dos palabras', 'x"y', '']) {
    assert.throws(() => registrarLectura({ script: 'token.mjs', nombre, resultado: 'ok', ruta }), /wrong shape/);
  }
  assert.throws(() => registrarLectura({ script: 'token.mjs', nombre: 'a', resultado: 'Too many requests', ruta }), /wrong shape/);
  assert.throws(() => readFileSync(ruta), { code: 'ENOENT' });
}));

test('contarLecturas: counts per script, ok apart from errors, and sums', () => conRegistro((ruta) => {
  const reg = (script, resultado) => registrarLectura({ script, nombre: 'fabrica-constructor.pem', resultado, ruta });
  reg('token.mjs', 'ok'); reg('token.mjs', 'limite-de-1password'); reg('token.mjs', 'ok'); reg('otro.mjs', 'sin-clave');
  const c = contarLecturas({ ruta });
  assert.deepEqual(c, { 'token.mjs': { total: 3, ok: 2, error: 1 }, 'otro.mjs': { total: 1, ok: 0, error: 1 } });
  assert.equal(Object.values(c).reduce((a, x) => a + x.total, 0), 4);
}));

test('contarLecturas: no file is no reads; a broken line throws instead of giving a wrong number', () => conRegistro((ruta) => {
  assert.deepEqual(contarLecturas({ ruta }), {});
  registrarLectura({ script: 'token.mjs', nombre: 'a', resultado: 'ok', ruta });
  writeFileSync(ruta, `${readFileSync(ruta, 'utf8')}{roto\n`);
  assert.throws(() => contarLecturas({ ruta }), /line 2 is not JSON/);
}));

test('clavePrivada: every op read leaves exactly one line: ok, rate limited and failed, never the .pem', () => {
  const lineas = [];
  const registrar = (l) => lineas.push(l);
  const env = { OP_SERVICE_ACCOUNT_TOKEN: 'ops_x' };
  clavePrivada(env, () => ({ status: 0, stdout: PEM, stderr: '' }), registrar);
  assert.throws(() => clavePrivada(env, () => ({ status: 1, stdout: '', stderr: 'Too many requests' }), registrar));
  assert.throws(() => clavePrivada(env, () => ({ status: 1, stdout: '', stderr: 'denied' }), registrar));
  assert.deepEqual(lineas.map((l) => l.resultado), ['ok', 'limite-de-1password', 'sin-clave']);
  assert.ok(lineas.every((l) => l.script === 'token.mjs' && l.nombre === 'fabrica-constructor.pem'));
  assert.ok(!JSON.stringify(lineas).includes('SECRETO'));
});

test('clavePrivada: a log that cannot be written is reported on stderr and does not hide the read', (t) => {
  const avisos = [];
  t.mock.method(console, 'error', (m) => avisos.push(m));
  const pem = clavePrivada({ OP_SERVICE_ACCOUNT_TOKEN: 'ops_x' }, () => ({ status: 0, stdout: PEM, stderr: '' }), () => { throw new Error('disk full'); });
  assert.equal(pem, PEM);
  assert.deepEqual(avisos, ['op-reads log not written: disk full']);
});

test('every reason of MOTIVOS and `ok` pass the log\'s shape check (one vocabulary)', () => conRegistro((ruta) => {
  for (const resultado of ['ok', ...Object.keys(MOTIVOS)]) registrarLectura({ script: 'token.mjs', nombre: 'a', resultado, ruta });
  assert.equal(contarLecturas({ ruta })['token.mjs'].total, 1 + Object.keys(MOTIVOS).length);
}));
