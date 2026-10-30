// Token cache: everything injected (disk = temp directory, clock, op, fetch). Nothing here calls
// the real `op`, `gh` or the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import * as fsReal from 'node:fs';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BLOQUEO_VIEJO_MS, conBloqueo, escribirCache, leerCache, MARGEN_MS, MOTIVO, MOTIVOS_CACHE, permisosDelUsuario, principalesDeIcacls, protegerFichero, rutaDeCache } from '../scripts/lib/token-cache.mjs';
import { avisoCache, clavePrivada, DOCUMENTO_CLAVE, ErrorToken, IDENTIDAD_POR_DEFECTO, MOTIVOS, obtenerToken } from '../scripts/token.mjs';
import { IDENTIDADES, VARIABLE_IDENTIDAD } from '../scripts/lib/identities.mjs';
import { OWNER_LOGIN } from '../scripts/lib/repo.mjs';

// A repo whose owner is not REPO's (the cache cannot tell owners apart) and where fabrica-constructor is valid (identidadActiva refuses any other).
const OTRO_DUENO = `${OWNER_LOGIN}/MenuPlan`;

const TOKEN = `ghs_${'a1B2c3D4'.repeat(5)}`;
const OTRO = `ghs_${'Z9y8X7w6'.repeat(5)}`;
const CLIENT = 'Iv_test_client';
const HORA = 60 * 60 * 1000;
const { privateKey: PEM } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

// A fixed instant in the past (so the lock files the tests really create, stamped with the real time, never
// look older than the fake clock) and a clock that only moves when the test says so (sleeping in the lock
// loop moves it too).
const INSTANTE = Date.parse('2020-01-01T00:00:00Z');
function relojFalso() {
  const r = { desfase: 0, ahora: () => INSTANTE + r.desfase, avanzar: (ms) => { r.desfase += ms; } };
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
  e.avisos = [];
  e.cache = { ruta: e.ruta, proteger: () => true, permisosBien: () => true, dormir: async (ms) => reloj.avanzar(ms), avisar: (m) => { e.avisos.push(m); } };
  e.pedir = (extra = {}) => obtenerToken({ env: { FABRICA_CONSTRUCTOR_CLIENT_ID: cliente }, leer: e.leer, fetchFn: github.fetch, reloj: reloj.ahora, cache: e.cache, ...extra });
  e.limpiar = () => rmSync(dir, { recursive: true, force: true });
  return e;
}

function guardado(e, { restante = HORA, token = TOKEN, appId = CLIENT } = {}) {
  const r = escribirCache({ ruta: e.ruta, proteger: () => true, datos: { token, expiraEn: iso(e.reloj.ahora() + restante), appId } });
  assert.equal(r, MOTIVO.ok);
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
    const leer = (extra = {}) => {
      return leerCache({ ruta: e.ruta, ids: { appId: CLIENT }, reloj: e.reloj.ahora, permisosBien: () => true, ...extra });
    };
    assert.equal(leer().motivo, 'ausente');
    guardado(e);
    assert.deepEqual(leer().entrada, { token: TOKEN });
    assert.equal(leer({ permisosBien: () => false }).motivo, 'permisos');
    assert.equal(leer({ ids: { appId: 'otra' } }).motivo, 'otra-app');
    e.reloj.avanzar(HORA + 1000);
    assert.equal(leer().motivo, 'caducado');
    writeFileSync(e.ruta, '{no es json');
    assert.equal(leer().motivo, 'corrupto');
    writeFileSync(e.ruta, JSON.stringify({ v: 1, token: TOKEN, expiraEn: iso(e.reloj.ahora() + HORA), appId: CLIENT, extra: 1 }));
    assert.equal(leer().motivo, 'forma');
    writeFileSync(e.ruta, JSON.stringify({ v: 1, token: 'ghs_corto', expiraEn: iso(e.reloj.ahora() + HORA), appId: CLIENT }));
    assert.equal(leer().motivo, 'forma');
    // a file that cannot be inspected or read is `disco`, not `ausente`
    const roto = (cual) => ({ ...fsReal, [cual]: () => { throw Object.assign(new Error('x'), { code: 'EACCES' }); } });
    assert.equal(leer({ fs: roto('statSync') }).motivo, 'disco');
    assert.equal(leer({ fs: roto('readFileSync') }).motivo, 'disco');
    // an old entry that still carries the installation id has an unexpected shape
    writeFileSync(e.ruta, JSON.stringify({ v: 1, token: TOKEN, expiraEn: iso(e.reloj.ahora() + HORA), appId: CLIENT, installationId: 77 }));
    assert.equal(leer().motivo, 'forma');
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
    const datos = { token: TOKEN, expiraEn: iso(e.reloj.ahora() + HORA), appId: CLIENT };
    assert.equal(escribirCache({ ruta: e.ruta, proteger: () => false, datos }), MOTIVO.permisos);
    assert.deepEqual(readdirSync(join(e.dir, 'Fabrica')), []);
    assert.equal(escribirCache({ ruta: e.ruta, proteger: () => true, datos: { ...datos, token: 'ghs_corto' } }), MOTIVO.forma);
    assert.equal(escribirCache({ ruta: e.ruta, proteger: () => true, datos, fs: { ...fsReal, renameSync: () => { throw new Error('x'); } } }), MOTIVO.disco);
    assert.deepEqual(readdirSync(join(e.dir, 'Fabrica')), [], 'no temp file is left behind');
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

test('conBloqueo: a lock older than BLOQUEO_VIEJO_MS is an orphan and is taken over', async () => {
  const e = entorno();
  try {
    await conBloqueo({ ruta: e.ruta, reloj: e.reloj.ahora, fn: async () => {} });
    writeFileSync(`${e.ruta}.lock`, '1');
    const viejo = new Date(INSTANTE - BLOQUEO_VIEJO_MS - 1000);
    utimesSync(`${e.ruta}.lock`, viejo, viejo);
    const r = await conBloqueo({ ruta: e.ruta, reloj: e.reloj.ahora, fn: async (s) => s });
    assert.equal(r.bloqueado, true);
  } finally { e.limpiar(); }
});

// lesson: token-cache-pem-reads
test('obtenerToken: many calls in the same hour read the .pem once and exchange once', async () => {
  const e = entorno();
  try {
    for (let i = 0; i < 20; i++) assert.equal((await e.pedir()).token, TOKEN);
    assert.equal(e.lecturas, 1);
    assert.equal(e.github.llamadas, 2); // GET installation + POST access_tokens, once
  } finally { e.limpiar(); }
});

test('obtenerToken: with less than MARGEN_MS left it exchanges again', async () => {
  const e = entorno();
  try {
    await e.pedir();
    e.reloj.avanzar(HORA - MARGEN_MS + 1000);
    await e.pedir();
    assert.equal(e.lecturas, 2);
  } finally { e.limpiar(); }
});

test('obtenerToken: each unusable cache leads to a fresh read and says its reason on stderr; ausente and a normal refresh stay silent', async () => {
  const casos = {
    expired: [(e) => { guardado(e); e.reloj.avanzar(2 * HORA); }, ['caducado']],
    corrupt: [(e) => { guardado(e); writeFileSync(e.ruta, '{roto'); }, ['corrupto']],
    shape: [(e) => { guardado(e); writeFileSync(e.ruta, JSON.stringify({ v: 2 })); }, ['forma']],
    permissions: [(e) => { guardado(e); e.cache.permisosBien = () => false; }, ['permisos']],
    'wrong app': [(e) => guardado(e, { appId: 'otra-app' }), ['otra-app']],
    unreadable: [(e) => { guardado(e); e.cache.fs = { ...fsReal, readFileSync: () => { throw new Error('x'); } }; }, ['disco']],
    absent: [() => {}, []],
    'under the margin': [(e) => guardado(e, { restante: MARGEN_MS - 1000 }), []],
  };
  for (const [nombre, [prepara, avisos]] of Object.entries(casos)) {
    const e = entorno();
    try {
      prepara(e);
      const r = await e.pedir();
      assert.equal(r.token, TOKEN, nombre);
      assert.equal(e.lecturas, 1, nombre);
      assert.deepEqual(e.avisos, avisos, nombre);
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
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(e.ruta, 'utf8'))).sort(), ['appId', 'expiraEn', 'token', 'v']);
  } finally { e.limpiar(); }
});

test('obtenerToken: another owner\'s repo bypasses the cache (the cache cannot tell owners apart)', async () => {
  const e = entorno();
  try {
    await e.pedir({ env: { FABRICA_CONSTRUCTOR_CLIENT_ID: CLIENT, FABRICA_REPO: OTRO_DUENO } });
    await e.pedir({ env: { FABRICA_CONSTRUCTOR_CLIENT_ID: CLIENT, FABRICA_REPO: OTRO_DUENO } });
    assert.equal(e.lecturas, 2);
    assert.equal(existsSync(e.ruta), false);
  } finally { e.limpiar(); }
});

test('obtenerToken: a cache that cannot be saved still returns the token and says why', async () => {
  const casos = {
    permisos: (e) => { e.cache.proteger = () => false; },
    disco: (e) => { e.cache.fs = { ...fsReal, renameSync: () => { throw new Error('x'); } }; },
  };
  for (const [motivo, prepara] of Object.entries(casos)) {
    const e = entorno();
    try {
      prepara(e);
      assert.equal((await e.pedir()).token, TOKEN);
      assert.deepEqual(e.avisos, [motivo]);
      assert.equal(existsSync(e.ruta), false);
    } finally { e.limpiar(); }
  }
});

test('obtenerToken: a lock that cannot be created is reported (disco) and the exchange goes ahead', async () => {
  const e = entorno();
  try {
    e.cache.fs = { ...fsReal, writeFileSync: () => { throw Object.assign(new Error('x'), { code: 'EPERM' }); } };
    assert.equal((await e.pedir()).token, TOKEN);
    assert.deepEqual(e.avisos, ['disco', 'disco']); // the lock, then the save
  } finally { e.limpiar(); }
});

test('obtenerToken: a disabled cache is reported (sin-ruta, otro-dueno) and still exchanges', async () => {
  const e = entorno();
  try {
    e.cache.ruta = null;
    assert.equal((await e.pedir()).token, TOKEN);
    assert.deepEqual(e.avisos, ['sin-ruta']);
    e.avisos.length = 0;
    e.cache.ruta = e.ruta;
    await e.pedir({ env: { FABRICA_CONSTRUCTOR_CLIENT_ID: CLIENT, FABRICA_REPO: OTRO_DUENO } });
    assert.deepEqual(e.avisos, ['otro-dueno']);
  } finally { e.limpiar(); }
});

test('avisoCache: one stderr line with the reason; a reason outside the vocabulary throws', (t) => {
  const lineas = [];
  t.mock.method(console, 'error', (l) => lineas.push(l));
  avisoCache(MOTIVO.permisos);
  assert.deepEqual(lineas, ['cache: permisos']);
  assert.throws(() => avisoCache('inventado'), /outside the vocabulary/);
});

// op fake: one result per call, counting calls.
const opFalso = (resultado) => { const f = () => { f.llamadas++; return resultado; }; f.llamadas = 0; return f; };
const nadie = () => {}; // the read log is not under test here: it must never touch the real ~/.fabrica
const LIBRE = () => ({ total: 0, porScript: {}, corruptas: [] }); // an empty budget count: never read the real read log
const LIMITE = { status: 1, stdout: '', stderr: '[ERROR] 2026/10/16 Too many requests. Try again in 3 hours. op_SECRETO_VALOR' };

test('clavePrivada: "Too many requests" -> limite-de-1password, one op call, no retry, no op output in the message', () => {
  const op = opFalso(LIMITE);
  assert.throws(
    () => clavePrivada({ OP_SERVICE_ACCOUNT_TOKEN: 'ops_x' }, op, nadie, LIBRE),
    (x) => x instanceof ErrorToken && x.motivo === 'limite-de-1password' && !x.message.includes('SECRETO') && !x.message.includes('\n'),
  );
  assert.equal(op.llamadas, 1);
});

test('clavePrivada: another failure is sin-clave; success returns the key; the vault is the configured one only', () => {
  assert.throws(() => clavePrivada({ OP_SERVICE_ACCOUNT_TOKEN: 'ops_x' }, opFalso({ status: 1, stdout: '', stderr: 'no access' }), nadie, LIBRE), (x) => x.motivo === 'sin-clave');
  const argsDeOp = [];
  const op = (args) => { argsDeOp.push(args); return { status: 0, stdout: PEM, stderr: '' }; };
  assert.equal(clavePrivada({ OP_SERVICE_ACCOUNT_TOKEN: 'ops_x', OP_VAULT: 'V' }, op, nadie, LIBRE), PEM);
  assert.deepEqual(argsDeOp, [['document', 'get', DOCUMENTO_CLAVE, '--vault', 'V']]);
});

test('clavePrivada: the read log records the same document that op is asked for', () => {
  const pedidos = [];
  const anotados = [];
  const op = (args) => { pedidos.push(args[2]); return { status: 0, stdout: PEM, stderr: '' }; };
  clavePrivada({ OP_SERVICE_ACCOUNT_TOKEN: 'ops_x' }, op, (linea) => anotados.push(linea.nombre), LIBRE);
  assert.deepEqual(anotados, pedidos);
  assert.deepEqual(pedidos, [DOCUMENTO_CLAVE]);
});

// FABRICA_IDENTIDAD (test/identidad-activa.test.js has the rest): the document and the vault are those of the active identity.
test('clavePrivada: document and vault come from the active identity; OP_VAULT only changes the vault; no App fails before op', () => {
  const { app } = IDENTIDADES[IDENTIDAD_POR_DEFECTO];
  const pedidos = [];
  const op = (args) => { pedidos.push(args); return { status: 0, stdout: PEM, stderr: '' }; };
  clavePrivada({ OP_SERVICE_ACCOUNT_TOKEN: 'ops_x', [VARIABLE_IDENTIDAD]: IDENTIDAD_POR_DEFECTO }, op, nadie, LIBRE);
  clavePrivada({ OP_SERVICE_ACCOUNT_TOKEN: 'ops_x', OP_VAULT: 'Otra' }, op, nadie, LIBRE);
  assert.deepEqual(pedidos, [['document', 'get', app.documento, '--vault', app.boveda], ['document', 'get', app.documento, '--vault', 'Otra']]);
  const nunca = () => { throw new Error('op must not run'); };
  assert.throws(() => clavePrivada({ OP_SERVICE_ACCOUNT_TOKEN: 'ops_x', [VARIABLE_IDENTIDAD]: 'ninguna' }, nunca, nadie, LIBRE), /no tiene App/);
});

test('obtenerToken: rate limited with no saved token -> limite-de-1password, one read, no second attempt', async () => {
  const e = entorno();
  const op = opFalso(LIMITE);
  try {
    await assert.rejects(e.pedir({ leer: (env) => clavePrivada({ ...env, OP_SERVICE_ACCOUNT_TOKEN: 'ops_x' }, op, nadie, LIBRE) }), (x) => x.motivo === 'limite-de-1password');
    assert.equal(op.llamadas, 1);
  } finally { e.limpiar(); }
});

test('obtenerToken: rate limited with a saved token still alive (but under MARGEN_MS) -> uses it and says why', async () => {
  const e = entorno();
  const op = opFalso(LIMITE);
  try {
    guardado(e, { restante: MARGEN_MS / 3, token: OTRO });
    const r = await e.pedir({ leer: (env) => clavePrivada({ ...env, OP_SERVICE_ACCOUNT_TOKEN: 'ops_x' }, op, nadie, LIBRE) });
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

test('MOTIVOS_CACHE: one case per reason of the vocabulary, run here, each producing exactly that reason', async () => {
  const leer = (e, extra = {}) => leerCache({ ruta: e.ruta, ids: { appId: CLIENT }, reloj: e.reloj.ahora, permisosBien: () => true, ...extra }).motivo;
  const otroDueno = { FABRICA_CONSTRUCTOR_CLIENT_ID: CLIENT, FABRICA_REPO: OTRO_DUENO };
  const casos = {
    ok: (e) => { guardado(e); return leer(e); },
    ausente: (e) => leer(e),
    corrupto: (e) => { guardado(e); writeFileSync(e.ruta, '{roto'); return leer(e); },
    forma: (e) => { guardado(e); writeFileSync(e.ruta, JSON.stringify({ v: 2 })); return leer(e); },
    caducado: (e) => { guardado(e); e.reloj.avanzar(2 * HORA); return leer(e); },
    'otra-app': (e) => { guardado(e); return leer(e, { ids: { appId: 'otra' } }); },
    permisos: (e) => { guardado(e); return leer(e, { permisosBien: () => false }); },
    disco: (e) => { guardado(e); return leer(e, { fs: { ...fsReal, statSync: () => { throw Object.assign(new Error('x'), { code: 'EACCES' }); } } }); },
    'sin-ruta': async (e) => { e.cache.ruta = null; await e.pedir(); return e.avisos[0]; },
    'otro-dueno': async (e) => { await e.pedir({ env: otroDueno }); return e.avisos[0]; },
  };
  assert.deepEqual(Object.keys(casos).sort(), [...MOTIVOS_CACHE].sort(), 'the table has exactly one case per reason');
  for (const [motivo, caso] of Object.entries(casos)) {
    const e = entorno();
    try {
      assert.equal(await caso(e), motivo);
    } finally { e.limpiar(); }
  }
});
