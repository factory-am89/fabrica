// token.mjs envuelve git con un helper de credenciales por variables de entorno, y el llavero
// no da por buena una entrada que no existe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { entornoHijo, ErrorLlavero, HELPER_GIT, leerLlavero, ordenLeerLlavero } from '../scripts/token.mjs';

const TOKEN = 'ghs_TOKEN_DE_PRUEBA_123';

test('entornoHijo: con git, helper vacío y luego el de la App, solo por entorno y sin el token en ellos', () => {
  const e = entornoHijo(['git', 'push'], TOKEN, {});
  assert.equal(e.GH_TOKEN, TOKEN);
  assert.equal(e.GIT_CONFIG_COUNT, '2');
  assert.deepEqual([e.GIT_CONFIG_KEY_0, e.GIT_CONFIG_VALUE_0], ['credential.helper', '']);
  assert.deepEqual([e.GIT_CONFIG_KEY_1, e.GIT_CONFIG_VALUE_1], ['credential.helper', HELPER_GIT]);
  for (const [k, v] of Object.entries(e)) if (k !== 'GH_TOKEN') assert.ok(!String(v).includes(TOKEN), `${k} lleva el token`);
  assert.ok(!HELPER_GIT.includes(TOKEN));
});

test('entornoHijo: respeta GIT_CONFIG_COUNT previo y reconoce git.exe con ruta', () => {
  const e = entornoHijo(['C:\\Program Files\\Git\\cmd\\git.exe', 'fetch'], TOKEN, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'a.b', GIT_CONFIG_VALUE_0: 'c' });
  assert.equal(e.GIT_CONFIG_COUNT, '3');
  assert.equal(e.GIT_CONFIG_KEY_0, 'a.b');
  assert.equal(e.GIT_CONFIG_VALUE_1, '');
  assert.equal(e.GIT_CONFIG_VALUE_2, HELPER_GIT);
});

test('entornoHijo: con otra orden (gh, node…) solo añade GH_TOKEN', () => {
  for (const c of [['gh', 'pr', 'create'], ['node', 'x.js'], ['gitk']]) {
    const e = entornoHijo(c, TOKEN, { A: '1' });
    assert.deepEqual(e, { A: '1', GH_TOKEN: TOKEN });
  }
});

// Un git de verdad con un helper de SISTEMA que deja una marca si se le consulta (como el «manager»
// de Windows): con el entorno de token.mjs, git pide credenciales al helper de la App y nunca al de sistema.
test('git con entornoHijo no consulta el helper de sistema y recibe el token de la App', () => {
  const d = mkdtempSync(join(tmpdir(), 'tokgit-'));
  try {
    const marca = join(d, 'marca').replaceAll('\\', '/');
    writeFileSync(join(d, 'sistema'), `[credential]\n\thelper = !echo consultado >> "${marca}" #\n`);
    writeFileSync(join(d, 'global'), '');
    // Sin ninguna GIT_CONFIG_* ni token heredados de quien lance el test (una sesión puede traer los suyos).
    const base = { ...process.env, GIT_CONFIG_SYSTEM: join(d, 'sistema'), GIT_CONFIG_GLOBAL: join(d, 'global') };
    for (const k of Object.keys(base)) if (/^GIT_CONFIG_(COUNT|KEY_|VALUE_|NOSYSTEM)/.test(k) || /^(GH|GITHUB)_TOKEN$/.test(k)) delete base[k];
    const entrada = 'protocol=https\nhost=github.com\n\n';
    const correr = (env) => spawnSync('git', ['credential', 'fill'], { input: entrada, encoding: 'utf8', env, timeout: 20000 });

    // Control: sin el helper de la App, el de sistema SI se consulta (el test reproduce el caso real).
    const c0 = correr({ ...base, GIT_TERMINAL_PROMPT: '0' });
    assert.ok(existsSync(marca), 'control: el helper de sistema debería consultarse sin token.mjs ' + c0.stderr);
    rmSync(marca);

    const r = correr(entornoHijo(['git', 'push'], TOKEN, base));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /username=x-access-token/);
    assert.ok(r.stdout.includes(`password=${TOKEN}`));
    assert.ok(!existsSync(marca), 'el helper de sistema no debe consultarse');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// Solo lectura de un recurso que seguro no existe. Antes de poner Stop, la excepción de Retrieve
// cortaba solo esa sentencia y el proceso salía con 0.
test('llavero: la orden de lectura de una entrada inexistente sale con error', { skip: process.platform !== 'win32' }, () => {
  const inexistente = `fabrica-test-inexistente-${Math.random().toString(36).slice(2)}`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ordenLeerLlavero(inexistente, 'service-account')], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout.trim(), '');
  assert.equal(leerLlavero(inexistente, 'service-account'), '');
});

// lesson: keychain-timeout-disguised-as-missing
test('llavero: entrada inexistente da vacío; timeout o fallo de powershell lanza ErrorLlavero con la causa', () => {
  const falso = (r) => () => r;
  assert.equal(leerLlavero('r', 'u', falso({ status: 1, stdout: '' })), '');
  assert.equal(leerLlavero('r', 'u', falso({ status: 0, stdout: 'tok' })), 'tok');
  const casos = [
    [{ status: null, signal: 'SIGTERM', error: Object.assign(new Error('x'), { code: 'ETIMEDOUT' }) }, /timeout/],
    [{ status: 3 }, /salida 3/],
    [{ status: null, error: Object.assign(new Error('x'), { code: 'ENOENT' }) }, /ENOENT/],
  ];
  for (const [r, causa] of casos) {
    assert.throws(() => leerLlavero('r', 'u', falso(r)), (e) => e instanceof ErrorLlavero && causa.test(e.message));
  }
});
