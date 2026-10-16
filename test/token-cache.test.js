// Token cache: everything injected (disk = temp directory, clock, op, fetch). Nothing here calls
// the real `op`, `gh` or the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conBloqueo, escribirCache, leerCache, MARGEN_MS, MOTIVOS_CACHE, permisosDelUsuario, principalesDeIcacls, protegerFichero, rutaDeCache } from '../scripts/lib/cache-token.mjs';
import { clavePrivada, ErrorToken, MOTIVOS, obtenerToken } from '../scripts/token.mjs';

const TOKEN = `ghs_${'a1B2c3D4'.repeat(5)}`;
const OTRO = `ghs_${'Z9y8X7w6'.repeat(5)}`;
const CLIENT = 'Iv_test_client';
const HORA = 60 * 60 * 1000;
const { privateKey: PEM } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

// A clock that only moves when the test says so (sleeping in the lock loop moves it too).
function relojFalso() {
  const r = { desfase: 0, ahora: () => Date.now() + r.desfase, avanzar: (ms) => { r.desfase += ms; } };
  return r;
}

const dirTemporal = () => mkdtempSync(join(tmpdir(), 'fabrica-cache-'));
const iso = (ms) => new Date(ms).toISOString();

// A fake GitHub that counts calls and returns `token`, valid for one hour from the fake clock.
function githubFalso(reloj, token = TOKEN) {
  const f = { llamadas: 0, token };
  f.fetch = async (url) => {
    f.llamadas++;
    const cuerpo = url.endsWith('/installation') ? { id: 77 } : { token: f.token, expires_at: iso(reloj.ahora() + HORA) };
    return { ok: true, status: 200, json: async () => cuerpo };
  };
  return f;
}

// Everything a call to obtenerToken needs, with a counter of .pem reads.
function entorno({ cliente = CLIENT } = {}) {
  const dir = dirTemporal();
  const reloj = relojFalso();
  const github = githubFalso(reloj);
  const e = { dir, reloj, github, lecturas: 0, ruta: join(dir, 'Fabrica', 'token-cache.json') };
  e.leer = () => { e.lecturas++; return PEM; };
  e.cache = { ruta: e.ruta, proteger: () => true, permisosBien: () => true, dormir: async (ms) => reloj.avanzar(ms) };
  e.pedir = (extra = {}) => obtenerToken({ env: { FABRICA_CONSTRUCTOR_CLIENT_ID: cliente }, leer: e.leer, fetchFn: github.fetch, reloj: reloj.ahora, cache: e.cache, ...extra });
  e.limpiar = () => rmSync(dir, { recursive: true, force: true });
  return e;
}

function guardado(e, { restante = HORA, token = TOKEN, appId = CLIENT } = {}) {
  const ok = escribirCache({ ruta: e.ruta, proteger: () => true, datos: { token, expiraEn: iso(e.reloj.ahora() + restante), appId, installationId: 77 } });
  assert.ok(ok);
}

test('cache path: inside the user profile, never OneDrive, with a fallback', () => {
  const casa = () => 'C:\\Users\\pablo';
  assert.equal(rutaDeCache({ LOCALAPPDATA: 'C:\\Users\\pablo\\AppData\\Local' }, casa), join('C:\\Users\\pablo\\AppData\\Local', 'Fabrica', 'token-cache.json'));
  assert.equal(rutaDeCache({ LOCALAPPDATA: 'C:\\Users\\pablo\\OneDrive\\x' }, casa), join('C:\\Users\\pablo', '.fabrica', 'token-cache.json'));
  assert.equal(rutaDeCache({ LOCALAPPDATA: 'D:\\otro' }, casa), join('C:\\Users\\pablo', '.fabrica', 'token-cache.json'));
  assert.equal(rutaDeCache({}, () => 'C:\\Users\\pablo\\OneDrive'), null);
});

test('leerCache: absent, wrong permissions, corrupt, wrong shape, wrong app, expired and ok, each with its reason', () => {
  const e = entorno();
  try {
    const leer = (extra = {}) => leerCache({ ruta: e.ruta, ids: { appId: CLIENT }, reloj: e.reloj.ahora, permisosBien: () => true, ...extra });
    assert.equal(leer().motivo, 'ausente');
    guardado(e);
    assert.equal(leer().motivo, 'ok');
    assert.equal(leer({ permisosBien: () => false }).motivo, 'permisos');
    assert.equal(leer({ ids: { appId: 'otra' } }).motivo, 'otra-app');
    e.reloj.avanzar(HORA + 1000);
    assert.equal(leer().motivo, 'caducado');
    writeFileSync(e.ruta, '{no es json');
    assert.equal(leer().motivo, 'corrupto');
    writeFileSync(e.ruta, JSON.stringify({ v: 1, token: TOKEN, expiraEn: iso(e.reloj.ahora() + HORA), appId: CLIENT, installationId: 77, extra: 1 }));
    assert.equal(leer().motivo, 'forma');
    writeFileSync(e.ruta, JSON.stringify({ v: 1, token: 'ghs_corto', expiraEn: iso(e.reloj.ahora() + HORA), appId: CLIENT, installationId: 77 }));
    assert.equal(leer().motivo, 'forma');
    for (const m of ['ausente', 'permisos', 'otra-app', 'caducado', 'corrupto', 'forma']) assert.ok(MOTIVOS_CACHE.includes(m));
  } finally { e.limpiar(); }
});

test('leerCache: a file with wrong permissions is not even opened', () => {
  const e = entorno();
  try {
    guardado(e);
    const fs = { statSync, readFileSync: () => { throw new Error('read despite wrong permissions'); } };
    assert.equal(leerCache({ ruta: e.ruta, ids: { appId: CLIENT }, fs, permisosBien: () => false }).motivo, 'permisos');
  } finally { e.limpiar(); }
});

test('leerCache: an expiry further away than a token can live is rejected', () => {
  const e = entorno();
  try {
    guardado(e, { restante: 5 * HORA });
    assert.equal(leerCache({ ruta: e.ruta, ids: { appId: CLIENT }, reloj: e.reloj.ahora, permisosBien: () => true }).motivo, 'forma');
  } finally { e.limpiar(); }
});

test('escribirCache: if permissions cannot be closed nothing is written, not even the temp file', () => {
  const e = entorno();
  try {
    const ok = escribirCache({ ruta: e.ruta, proteger: () => false, datos: { token: TOKEN, expiraEn: iso(e.reloj.ahora() + HORA), appId: CLIENT, installationId: 77 } });
    assert.equal(ok, false);
    assert.deepEqual(readdirSync(join(e.dir, 'Fabrica')), []);
  } finally { e.limpiar(); }
});

test('real permissions: protegerFichero leaves a file that permisosDelUsuario accepts', () => {
  const dir = dirTemporal();
  try {
    const f = join(dir, 'x.json');
    writeFileSync(f, '{}');
    assert.equal(protegerFichero(f), true);
    assert.equal(permisosDelUsuario(f), true);
    // open it to everybody: it must stop being accepted
    if (process.platform === 'win32') execFileSync(join(process.env.SystemRoot, 'System32', 'icacls.exe'), [f, '/grant', '*S-1-1-0:(R)'], { stdio: 'ignore' });
    else chmodSync(f, 0o644);
    assert.equal(permisosDelUsuario(f), false);
    assert.equal(principalesDeIcacls('C:\\a\\x.json DOM\\pablo:(F)\n           BUILTIN\\Users:(R)\n', 'C:\\a\\x.json').length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('conBloqueo: runs holding the lock and releases it', async () => {
  const e = entorno();
  try {
    const visto = await conBloqueo({ ruta: e.ruta, reloj: e.reloj.ahora, fn: async (s) => ({ ...s, hay: existsSync(`${e.ruta}.lock`) }) });
    assert.deepEqual(visto, { bloqueado: true, razon: null, hay: true });
    assert.equal(existsSync(`${e.ruta}.lock`), false);
  } finally { e.limpiar(); }
});

test('conBloqueo: lock busy -> waits, then runs unlocked with the reason `ocupado`', async () => {
  const e = entorno();
  try {
    await conBloqueo({ ruta: e.ruta, reloj: e.reloj.ahora, fn: async () => {} }); // creates the folder
    writeFileSync(`${e.ruta}.lock`, '1');
    const r = await conBloqueo({ ruta: e.ruta, reloj: e.reloj.ahora, dormir: async (ms) => e.reloj.avanzar(ms), esperaMs: 500, sondeoMs: 100, fn: async (s) => s });
    assert.deepEqual(r, { bloqueado: false, razon: 'ocupado' });
    assert.ok(e.reloj.desfase >= 500, 'it waited the full allowance before giving up');
    assert.equal(existsSync(`${e.ruta}.lock`), true, 'a lock held by someone else is not removed');
  } finally { e.limpiar(); }
});

test('conBloqueo: a lock older than 20 s is an orphan and is taken over', async () => {
  const e = entorno();
  try {
    await conBloqueo({ ruta: e.ruta, fn: async () => {} });
    writeFileSync(`${e.ruta}.lock`, '1');
    const viejo = new Date(Date.now() - 60_000);
    utimesSync(`${e.ruta}.lock`, viejo, viejo);
    const r = await conBloqueo({ ruta: e.ruta, fn: async (s) => s });
    assert.equal(r.bloqueado, true);
  } finally { e.limpiar(); }
});

test('obtenerToken: 20 calls in the same hour read the .pem once and exchange once', async () => {
  const e = entorno();
  try {
    for (let i = 0; i < 20; i++) assert.equal((await e.pedir()).token, TOKEN);
    assert.equal(e.lecturas, 1);
    assert.equal(e.github.llamadas, 2); // GET installation + POST access_tokens, once
  } finally { e.limpiar(); }
});

test('obtenerToken: with less than 15 minutes left it exchanges again', async () => {
  const e = entorno();
  try {
    await e.pedir();
    e.reloj.avanzar(HORA - MARGEN_MS + 1000);
    await e.pedir();
    assert.equal(e.lecturas, 2);
  } finally { e.limpiar(); }
});

test('obtenerToken: expired, corrupt, wrong-permissions and wrong-app caches all lead to a fresh read', async () => {
  const casos = {
    expired: (e) => { guardado(e); e.reloj.avanzar(2 * HORA); },
    corrupt: (e) => { guardado(e); writeFileSync(e.ruta, '{roto'); },
    permissions: (e) => { guardado(e); e.cache.permisosBien = () => false; },
    'wrong app': (e) => guardado(e, { appId: 'otra-app' }),
  };
  for (const [nombre, prepara] of Object.entries(casos)) {
    const e = entorno();
    try {
      prepara(e);
      const r = await e.pedir();
      assert.equal(r.token, TOKEN, nombre);
      assert.equal(e.lecturas, 1, nombre);
    } finally { e.limpiar(); }
  }
});

test('obtenerToken: lock busy -> bloqueo-ocupado, no .pem read', async () => {
  const e = entorno();
  try {
    await conBloqueo({ ruta: e.ruta, fn: async () => {} });
    writeFileSync(`${e.ruta}.lock`, '1');
    await assert.rejects(e.pedir(), (x) => x instanceof ErrorToken && x.motivo === 'bloqueo-ocupado');
    assert.equal(e.lecturas, 0);
  } finally { e.limpiar(); }
});

test('obtenerToken: the .pem and the token never leak beyond the one token field of the cache file', async () => {
  const e = entorno();
  try {
    await e.pedir();
    const cuerpoPem = PEM.split('\n').filter((l) => l.length > 40)[0];
    for (const f of readdirSync(join(e.dir, 'Fabrica'))) {
      const texto = readFileSync(join(e.dir, 'Fabrica', f), 'utf8');
      assert.ok(!texto.includes('PRIVATE KEY') && !texto.includes(cuerpoPem), `${f} holds the .pem`);
    }
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(e.ruta, 'utf8'))).sort(), ['appId', 'expiraEn', 'installationId', 'token', 'v']);
  } finally { e.limpiar(); }
});

test('obtenerToken: another owner\'s repo bypasses the cache (the cache cannot tell owners apart)', async () => {
  const e = entorno();
  try {
    await e.pedir({ env: { FABRICA_CONSTRUCTOR_CLIENT_ID: CLIENT, FABRICA_REPO: 'otro-dueno/x' } });
    await e.pedir({ env: { FABRICA_CONSTRUCTOR_CLIENT_ID: CLIENT, FABRICA_REPO: 'otro-dueno/x' } });
    assert.equal(e.lecturas, 2);
    assert.equal(existsSync(e.ruta), false);
  } finally { e.limpiar(); }
});

// op fake: one result per call, counting calls.
const opFalso = (resultado) => { const f = () => { f.llamadas++; return resultado; }; f.llamadas = 0; return f; };
const LIMITE = { status: 1, stdout: '', stderr: '[ERROR] 2026/10/16 Too many requests. Try again in 3 hours. op_SECRETO_VALOR' };

test('clavePrivada: "Too many requests" -> limite-de-1password, one op call, no retry, no op output in the message', () => {
  const op = opFalso(LIMITE);
  assert.throws(
    () => clavePrivada({ OP_SERVICE_ACCOUNT_TOKEN: 'ops_x' }, op),
    (x) => x instanceof ErrorToken && x.motivo === 'limite-de-1password' && !x.message.includes('SECRETO') && !x.message.includes('\n'),
  );
  assert.equal(op.llamadas, 1);
});

test('clavePrivada: another failure is sin-clave; success returns the key; the vault is the configured one only', () => {
  assert.throws(() => clavePrivada({ OP_SERVICE_ACCOUNT_TOKEN: 'ops_x' }, opFalso({ status: 1, stdout: '', stderr: 'no access' })), (x) => x.motivo === 'sin-clave');
  const vistos = [];
  const op = (args) => { vistos.push(args); return { status: 0, stdout: PEM, stderr: '' }; };
  assert.equal(clavePrivada({ OP_SERVICE_ACCOUNT_TOKEN: 'ops_x', OP_VAULT: 'V' }, op), PEM);
  assert.deepEqual(vistos, [['document', 'get', 'fabrica-constructor.pem', '--vault', 'V']]);
});

test('obtenerToken: rate limited with no saved token -> limite-de-1password, one read, no second attempt', async () => {
  const e = entorno();
  const op = opFalso(LIMITE);
  try {
    await assert.rejects(e.pedir({ leer: (env) => clavePrivada({ ...env, OP_SERVICE_ACCOUNT_TOKEN: 'ops_x' }, op) }), (x) => x.motivo === 'limite-de-1password');
    assert.equal(op.llamadas, 1);
  } finally { e.limpiar(); }
});

test('obtenerToken: rate limited with a saved token still alive (but under 15 min) -> uses it and says why', async () => {
  const e = entorno();
  const op = opFalso(LIMITE);
  try {
    guardado(e, { restante: 5 * 60 * 1000, token: OTRO });
    const r = await e.pedir({ leer: (env) => clavePrivada({ ...env, OP_SERVICE_ACCOUNT_TOKEN: 'ops_x' }, op) });
    assert.equal(r.token, OTRO);
    assert.match(r.aviso, /^limite-de-1password: /);
    assert.ok(!r.aviso.includes('\n'));
    assert.equal(op.llamadas, 1);
  } finally { e.limpiar(); }
});

test('MOTIVOS: a closed list with a distinct non-zero exit code for each reason', () => {
  const codigos = Object.values(MOTIVOS);
  assert.equal(new Set(codigos).size, codigos.length);
  assert.ok(codigos.every((c) => Number.isInteger(c) && c > 1));
  assert.throws(() => new ErrorToken('inventado', 'x'));
});
