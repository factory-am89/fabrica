// convertir.mjs must check every prerequisite BEFORE it exchanges the single-use manifest code.
// Deterministic: fetch and the program runner are injected, no network, no process spawned.
// lesson: convertir-consumes-code-before-prechecks
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cli, previos } from '../apps/convertir.mjs';
import { REPO } from '../scripts/lib/repo.mjs';

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
