// convertir.mjs must check every prerequisite BEFORE it exchanges the single-use manifest code.
// Deterministic: fetch and the program runner are injected, no network, no process spawned.
// lesson: convertir-consumes-code-before-prechecks
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cli, previos } from '../apps/convertir.mjs';
import { REPO } from '../scripts/lib/repo.mjs';
import { leer } from './apoyo/fabrica.mjs';

// Fake runner: `gh auth status` and `gh api repos/<REPO>` answer as told; everything else (powershell) works.
const runner = ({ logged = true, admin = true, ps = true } = {}) => (programa, args) => {
  if (programa === 'gh' && args[0] === 'auth') return { status: logged ? 0 : 1, stdout: '' };
  if (programa === 'gh' && args[0] === 'api') {
    assert.equal(args[1], `repos/${REPO}`);
    return { status: 0, stdout: JSON.stringify({ permissions: { admin } }) };
  }
  return { status: ps ? 0 : 1, stdout: '' };
};

// Runs the command with a fetch that records its calls; returns the exit code and the URLs fetched.
async function lanzar(opciones) {
  const urls = [];
  const fetchFn = async (url) => { urls.push(url); return { ok: false, status: 404 }; };
  const errores = [];
  const original = console.error;
  console.error = (m) => errores.push(m);
  try {
    const salida = await cli(['CODE'], { fetchFn, runner: runner(opciones) });
    return { salida, urls, errores };
  } finally {
    console.error = original;
  }
}

test('with no gh session the code is not exchanged and the exit is 1', async () => {
  const { salida, urls, errores } = await lanzar({ logged: false });
  assert.equal(salida, 1);
  assert.deepEqual(urls, []);
  assert.match(errores.join('\n'), /gh auth login/);
  assert.match(errores.join('\n'), /one hour/);
});

test('with a gh account that is not admin the code is not exchanged and the exit is 1', async () => {
  const { salida, urls, errores } = await lanzar({ admin: false });
  assert.equal(salida, 1);
  assert.deepEqual(urls, []);
  assert.match(errores.join('\n'), /cannot administer/);
});

test('without powershell the code is not exchanged and the exit is 1', async () => {
  const { salida, urls } = await lanzar({ ps: false });
  assert.equal(salida, 1);
  assert.deepEqual(urls, []);
});

test('with every prerequisite met the code is exchanged', async () => {
  assert.deepEqual(previos(runner()), []);
  const { urls } = await lanzar();
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/app-manifests\/CODE\/conversions$/);
});

// Real causes are reported, not a false «not admin» / «not logged in».
const con = (parcial) => (programa, args) => {
  if (programa === 'gh') {
    const r = parcial(args);
    if (r) return r;
  }
  return { status: 0, stdout: '' };
};
const api = (r) => con((args) => (args[0] === 'api' ? r : null));

test('gh not installed (ENOENT) is reported as such, not as «not logged in»', () => {
  const p = previos(con(() => ({ error: new Error('spawn gh ENOENT') })));
  assert.equal(p.length, 1);
  assert.match(p[0], /ENOENT/);
  assert.doesNotMatch(p[0], /not logged in/);
});

test('a failed gh api (status not 0) reports its stderr, not «not admin»', () => {
  const p = previos(api({ status: 1, stdout: '', stderr: 'HTTP 404: Not Found' }));
  assert.equal(p.length, 1);
  assert.match(p[0], /HTTP 404: Not Found/);
  assert.doesNotMatch(p[0], /cannot administer/);
});

test('invalid JSON from gh api is reported as such, not «not admin»', () => {
  const p = previos(api({ status: 0, stdout: '<html>' }));
  assert.equal(p.length, 1);
  assert.match(p[0], /invalid JSON/);
  assert.doesNotMatch(p[0], /cannot administer/);
});

test('only an explicit permissions.admin false means «not admin»; a missing field is its own message', () => {
  assert.match(previos(api({ status: 0, stdout: '{"permissions":{"admin":false}}' }))[0], /cannot administer/);
  const sin = previos(api({ status: 0, stdout: '{}' }));
  assert.match(sin[0], /did not report permissions\.admin/);
  assert.doesNotMatch(sin[0], /cannot administer/);
});

// The fallback marker has ONE source (apps/marca-rescate.txt); arranque.ps1 reads it to rescue the key file.
test('arranque.ps1 and convertir.mjs take the fallback marker from the same file', () => {
  const ps1 = leer('apps/arranque.ps1');
  const mjs = leer('apps/convertir.mjs');
  assert.match(ps1, /marca-rescate\.txt/);
  assert.match(mjs, /marca-rescate\.txt/);
  assert.match(mjs, /`\$\{MARCA_RESCATE\}: \$\{motivo\}/, 'the fallback message starts with the shared marker');
  const marca = leer('apps/marca-rescate.txt').trim();
  assert.ok(marca.length > 0);
  assert.ok(!ps1.includes(`'${marca}'`) && !mjs.includes(`'${marca}'`), 'the marker is not written by hand in either file');
});

test('the key secret names come from one table', () => {
  const mjs = leer('apps/convertir.mjs');
  for (const nombre of ['ADMIN_APP_KEY', 'REVISOR_APP_KEY']) assert.equal(mjs.split(nombre).length - 1, 1, `${nombre} written once`);
});
