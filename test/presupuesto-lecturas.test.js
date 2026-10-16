// Read budget of token.mjs: how many `op` reads fit in a rolling hour, all scripts together.
// Injected clock, read log (a temp directory) and op: no real `op`, no real home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lecturasRecientes, VENTANA_MS } from '../scripts/lib/op-log.mjs';
import { clavePrivada, comprobarPresupuesto, ErrorToken, MOTIVOS, obtenerToken, PRESUPUESTO_LECTURAS, presupuestoDe, VARIABLE_PRESUPUESTO } from '../scripts/token.mjs';
import { escribirCache, MARGEN_MS } from '../scripts/lib/token-cache.mjs';

const PEM = '-----BEGIN RSA PRIVATE KEY-----\nVALOR-SECRETO-DE-PRUEBA\n-----END RSA PRIVATE KEY-----\n';
const AHORA = Date.UTC(2026, 9, 16, 12, 0, 0);
const MIN = 60 * 1000;
const MIN_VENTANA = VENTANA_MS / MIN;
const MIN_MARGEN = MARGEN_MS / MIN;
const MIN_CORTO = MIN_MARGEN / 3; // a saved token with less than MARGEN_MS left
const TOKEN_A = `ghs_${'a1B2c3D4'.repeat(5)}`;
const TOKEN_B = `ghs_${'Z9y8X7w6'.repeat(5)}`;
const iso = (ms) => new Date(ms).toISOString();
const linea = (script, haceMin, resultado = 'ok') => JSON.stringify({ t: iso(AHORA - haceMin * MIN), script, leido: 'fabrica-constructor.pem', resultado });

// A temp read log holding `lineas` (none = no file); `contar` is the real counter on that file with the fake clock.
function conRegistro(lineas, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'fabrica-presupuesto-'));
  const ruta = join(dir, '.fabrica', 'op-reads.jsonl');
  if (lineas) {
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, `${lineas.join('\n')}\n`);
  }
  const fin = () => rmSync(dir, { recursive: true, force: true });
  let r;
  try {
    r = fn({ dir, ruta, contar: () => lecturasRecientes({ ruta, reloj: () => AHORA }) });
  } catch (e) {
    fin();
    throw e;
  }
  return r instanceof Promise ? r.finally(fin) : (fin(), r);
}

const opFalso = () => { const f = () => { f.llamadas++; return { status: 0, stdout: PEM, stderr: '' }; }; f.llamadas = 0; return f; };
const nadie = () => {};
const ENV = { OP_SERVICE_ACCOUNT_TOKEN: 'ops_x', [VARIABLE_PRESUPUESTO]: '5' };
const muchas = (n, haceMin = 1) => Array.from({ length: n }, (_, i) => linea(i % 2 ? 'otro.mjs' : 'token.mjs', haceMin));

test('the budget is one exported constant; a closed reason with its own exit code', () => {
  assert.equal(presupuestoDe({}), PRESUPUESTO_LECTURAS);
  assert.ok(Number.isInteger(MOTIVOS['presupuesto-de-lecturas']) && MOTIVOS['presupuesto-de-lecturas'] > 1);
  assert.equal(new Set(Object.values(MOTIVOS)).size, Object.keys(MOTIVOS).length);
});

test('the override must be a positive integer: anything else throws, it never falls back to the default', () => {
  assert.equal(presupuestoDe({ [VARIABLE_PRESUPUESTO]: '7' }), 7);
  for (const malo of ['0', '-1', 'abc', '', '1.5', `${PRESUPUESTO_LECTURAS} `]) assert.throws(() => presupuestoDe({ [VARIABLE_PRESUPUESTO]: malo }), /positive integer/);
});

test('below the budget: the read happens', () => conRegistro(muchas(4), ({ contar }) => {
  const op = opFalso();
  assert.equal(clavePrivada(ENV, op, nadie, contar), PEM);
  assert.equal(op.llamadas, 1);
}));

test('at the budget: no read, the reason has its exit code and one line with the count and the split per script', () => conRegistro(muchas(5), ({ contar }) => {
  const op = opFalso();
  assert.throws(
    () => clavePrivada(ENV, op, nadie, contar),
    (x) => x instanceof ErrorToken && x.motivo === 'presupuesto-de-lecturas' && MOTIVOS[x.motivo] === MOTIVOS['presupuesto-de-lecturas']
      && x.message === '5 reads in the last hour (budget 5); per script: token.mjs=3, otro.mjs=2',
  );
  assert.equal(op.llamadas, 0);
}));

test('real process: at the budget it prints one `presupuesto-de-lecturas: N reads ...` line and exits with its code in MOTIVOS, before reaching op', () => conRegistro(null, ({ dir, ruta }) => {
  mkdirSync(dirname(ruta), { recursive: true });
  const contador = join(dir, 'contador.txt');
  writeFileSync(contador, '');
  // a fixed instant far in the future: it is always inside the window, whatever the real clock says
  const INSTANTE_FUTURO = Date.UTC(2999, 0, 1);
  const frescas = Array.from({ length: 3 }, () => JSON.stringify({ t: new Date(INSTANTE_FUTURO).toISOString(), script: 'token.mjs', leido: 'fabrica-constructor.pem', resultado: 'ok' }));
  writeFileSync(ruta, `${frescas.join('\n')}\n`);
  const env = {
    ...process.env, USERPROFILE: dir, HOME: dir, LOCALAPPDATA: join(dir, 'AppData', 'Local'),
    FABRICA_CONSTRUCTOR_CLIENT_ID: 'Iv_test', OP_SERVICE_ACCOUNT_TOKEN: 'ops_fake', [VARIABLE_PRESUPUESTO]: '3',
    FALSO_CONTADOR: contador, FALSO_PEM: PEM, // the preload answers any `op` call: a real one can never happen here
  };
  delete env.FABRICA_REPO;
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(fileURLToPath(new URL('./apoyo/precarga-falsa.mjs', import.meta.url))).href, fileURLToPath(new URL('../scripts/token.mjs', import.meta.url)), '--', process.execPath, '-e', '0'], { env, encoding: 'utf8' });
  assert.equal(r.status, MOTIVOS['presupuesto-de-lecturas'], r.stderr);
  assert.match(r.stderr.trim(), /^presupuesto-de-lecturas: 3 reads in the last hour \(budget 3\); per script: token\.mjs=3$/);
  assert.equal(readFileSync(contador, 'utf8'), '', 'op must not be reached');
}));

test('old entries (older than the window) do not count; the edge is exclusive', () => conRegistro([...muchas(10, MIN_VENTANA + 1), linea('token.mjs', MIN_VENTANA), linea('token.mjs', MIN_VENTANA - 1)], ({ contar }) => {
  const c = contar();
  assert.equal(c.total, 1);
  assert.deepEqual(c.porScript, { 'token.mjs': 1 });
  assert.equal(clavePrivada(ENV, opFalso(), nadie, contar), PEM);
}));

test('no log at all is zero reads', () => conRegistro(null, ({ contar }) => {
  assert.deepEqual(contar(), { total: 0, porScript: {}, corruptas: [] });
}));

test('a corrupt log line does not crash: it is reported on stderr, counted as a read, and cannot let a read through', (t) => conRegistro([...muchas(3), '{roto', '{"t":"nada","script":"x"}'], ({ contar }) => {
  const avisos = [];
  t.mock.method(console, 'error', (m) => avisos.push(m));
  const c = contar();
  assert.deepEqual(c.corruptas, [4, 5]);
  assert.equal(c.total, 5);
  assert.throws(() => clavePrivada(ENV, opFalso(), nadie, contar), (x) => x.motivo === 'presupuesto-de-lecturas' && /\(unreadable line\)=2/.test(x.message));
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /unreadable line\(s\) 4, 5 counted as reads/);
  assert.ok(!avisos[0].includes('roto'));
}));

test('comprobarPresupuesto returns quietly below the budget', () => {
  comprobarPresupuesto({ [VARIABLE_PRESUPUESTO]: '2' }, () => ({ total: 1, porScript: { 'token.mjs': 1 }, corruptas: [] }));
});

// obtenerToken against the temp log and a temp token cache, with a saved token that has `restanteMin` left.
function pedirConGuardado({ dir, contar }, restanteMin, token) {
  const ruta = join(dir, 'Fabrica', 'token-cache.json');
  if (restanteMin !== null) {
    assert.ok(escribirCache({ ruta, proteger: () => true, datos: { token, expiraEn: iso(AHORA + restanteMin * MIN), appId: 'Iv_test' } }));
  }
  const op = opFalso();
  const pedir = () => obtenerToken({
    env: { ...ENV, FABRICA_CONSTRUCTOR_CLIENT_ID: 'Iv_test' },
    leer: (env) => clavePrivada(env, op, nadie, contar),
    fetchFn: async () => { throw new Error('no network expected'); },
    reloj: () => AHORA,
    cache: { ruta, proteger: () => true, permisosBien: () => true },
  });
  return { op, pedir };
}

test('a cached valid token bypasses the budget: no read happens, so nothing is counted nor refused', () => conRegistro(muchas(9), async (e) => {
  const { op, pedir } = pedirConGuardado(e, MIN_VENTANA, TOKEN_A);
  assert.equal((await pedir()).token, TOKEN_A);
  assert.equal(op.llamadas, 0);
  // the same log does refuse a real read
  assert.throws(() => clavePrivada(ENV, op, nadie, e.contar), (x) => x.motivo === 'presupuesto-de-lecturas');
}));

test('over budget with no saved token: fails with the reason; with one alive under the margin: uses it and says why', () => conRegistro(muchas(9), async (e) => {
  await assert.rejects(pedirConGuardado(e, null).pedir(), (x) => x.motivo === 'presupuesto-de-lecturas');
  const r = await pedirConGuardado(e, MIN_CORTO, TOKEN_B).pedir();
  assert.equal(r.token, TOKEN_B);
  assert.equal(r.aviso, `presupuesto-de-lecturas: using the saved token (${MIN_CORTO} min left).`);
}));
