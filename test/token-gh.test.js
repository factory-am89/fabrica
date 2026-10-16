// token.mjs logs every gh call (api and result) and only gh calls; a failing log is reported and never blocks.
// Injected spawn and logger: no real gh, no network, no op.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esGh, lanzar } from '../scripts/token.mjs';

const ENV = { PATH: 'x' };
const conLlamadas = (respuesta) => {
  const lanzadas = [];
  const anotadas = [];
  const spawn = (cmd, args, opts) => { lanzadas.push({ cmd, args, opts }); return respuesta; };
  const registrar = (l) => anotadas.push(l);
  return { lanzadas, anotadas, spawn, registrar };
};

test('esGh: gh and gh.exe (any path or case), nothing else', () => {
  for (const c of ['gh', 'gh.exe', 'C:\\Program Files\\GitHub CLI\\gh.exe', '/usr/bin/gh', 'GH.EXE']) assert.ok(esGh([c]), c);
  for (const c of ['git', 'node', 'ghost', 'gh.cmd', 'npgh']) assert.ok(!esGh([c]), c);
});

test('lanzar: a gh call leaves one line with caller, api and result, and returns the exit status', () => {
  const t = conLlamadas({ status: 0, stderr: '' });
  const status = lanzar(['gh', 'pr', 'view', '3'], 'tok', { spawn: t.spawn, registrar: t.registrar, env: ENV, pasarStderr: () => {} });
  assert.equal(status, 0);
  assert.deepEqual(t.anotadas, [{ caller: 'token.mjs', api: 'graphql', resultado: 'ok' }]);
  assert.equal(t.lanzadas[0].opts.env.GH_TOKEN, 'tok');
});

test('lanzar: a rate limit on stderr is logged as limited, other failures as error; the status is kept', () => {
  const limitado = conLlamadas({ status: 1, stderr: 'GraphQL: API rate limit already exceeded' });
  assert.equal(lanzar(['gh', 'issue', 'list'], 't', { spawn: limitado.spawn, registrar: limitado.registrar, env: ENV, pasarStderr: () => {} }), 1);
  assert.deepEqual(limitado.anotadas, [{ caller: 'token.mjs', api: 'graphql', resultado: 'limited' }]);
  const roto = conLlamadas({ status: 4, stderr: 'HTTP 404' });
  assert.equal(lanzar(['gh', 'api', 'repos/o/r/issues/1'], 't', { spawn: roto.spawn, registrar: roto.registrar, env: ENV, pasarStderr: () => {} }), 4);
  assert.deepEqual(roto.anotadas, [{ caller: 'token.mjs', api: 'rest', resultado: 'error' }]);
});

test('lanzar: only gh is logged, and only gh has its stderr captured', () => {
  const t = conLlamadas({ status: 0, stderr: '' });
  lanzar(['git', 'push'], 't', { spawn: t.spawn, registrar: t.registrar, env: ENV, pasarStderr: () => {} });
  lanzar([process.execPath, '-e', '0'], 't', { spawn: t.spawn, registrar: t.registrar, env: ENV, pasarStderr: () => {} });
  assert.deepEqual(t.anotadas, []);
  assert.equal(t.lanzadas[0].opts.stdio, 'inherit');
  lanzar(['gh', 'run', 'list'], 't', { spawn: t.spawn, registrar: t.registrar, env: ENV, pasarStderr: () => {} });
  assert.deepEqual(t.lanzadas[2].opts.stdio, ['inherit', 'inherit', 'pipe']);
});

test('lanzar: a log that fails is reported on stderr and does not block nor change the status', (ctx) => {
  const errores = [];
  ctx.mock.method(console, 'error', (m) => errores.push(m));
  const t = conLlamadas({ status: 7, stderr: '' });
  const registrar = () => { throw new Error('disk full'); };
  assert.equal(lanzar(['gh', 'run', 'view', '1'], 't', { spawn: t.spawn, registrar, env: ENV, pasarStderr: () => {} }), 7);
  assert.deepEqual(errores, ['gh-calls log not written: disk full']);
});

test('lanzar: gh that cannot start is logged as error and then thrown', () => {
  const t = conLlamadas({ error: new Error('ENOENT'), status: null });
  assert.throws(() => lanzar(['gh', 'pr', 'list'], 't', { spawn: t.spawn, registrar: t.registrar, env: ENV, pasarStderr: () => {} }), /No pude lanzar «gh»: ENOENT/);
  assert.deepEqual(t.anotadas, [{ caller: 'token.mjs', api: 'graphql', resultado: 'error' }]);
});
