// La limpieza mira el PR fusionado en GitHub (no la ascendencia): squash, punta, sucia, unión, GitHub caído.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearTarea } from '../scripts/tarea.mjs';
import { limpiar } from '../scripts/limpiar.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FALSO = path.join(AQUI, 'fixtures', 'token-falso.mjs');

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

// <tmp>/fabrica con origin local y una carpeta por rama, cada una con un commit ya subido.
function mundo(ramas) {
  const padre = realpathSync(mkdtempSync(path.join(tmpdir(), 'limpiar-')));
  const principal = path.join(padre, 'fabrica');
  const remoto = path.join(padre, 'remoto.git');
  mkdirSync(principal);
  git(principal, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['commit.gpgsign', 'false']]) git(principal, 'config', k, v);
  writeFileSync(path.join(principal, 'a.txt'), 'a\n');
  git(principal, 'add', 'a.txt');
  git(principal, 'commit', '-q', '-m', 'inicial');
  git(padre, 'init', '-q', '--bare', '-b', 'main', remoto);
  git(principal, 'remote', 'add', 'origin', remoto);
  git(principal, 'push', '-q', 'origin', 'main');
  const carpetas = {};
  for (const rama of ramas) {
    const { carpeta } = crearTarea(rama, { cwd: principal, instalar: false });
    writeFileSync(path.join(carpeta, 'x.txt'), `${rama}\n`);
    git(carpeta, 'add', 'x.txt');
    git(carpeta, 'commit', '-q', '-m', rama);
    git(carpeta, 'push', '-q', 'origin', rama);
    carpetas[rama] = { carpeta, punta: git(carpeta, 'rev-parse', 'HEAD') };
  }
  return { padre, principal, remoto, carpetas };
}

const pr = (numero, rama, sha, fusionado = true) => ({
  number: numero, merged_at: fusionado ? '2026-10-16T10:00:00Z' : null, head: { ref: rama, sha },
});

function correr(m, prs, { ensayo = false, falla = false } = {}) {
  const prsFichero = path.join(m.padre, 'prs.json');
  const log = path.join(m.padre, 'llamadas.log');
  writeFileSync(prsFichero, JSON.stringify(prs));
  process.env.FALSO_PRS = prsFichero;
  process.env.FALSO_LOG = log;
  if (falla) process.env.FALSO_FALLA = '1';
  else delete process.env.FALSO_FALLA;
  const salida = limpiar({ cwd: m.principal, ensayo, token: FALSO, repo: 'o/r' });
  const llamadas = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  return { salida, llamadas };
}

const ramasRemotas = (m) => git(m.principal, 'ls-remote', '--heads', 'origin').split('\n').filter(Boolean).map((l) => l.split('refs/heads/')[1]);
const ramasLocales = (m) => git(m.principal, 'branch', '--format=%(refname:short)').split('\n');

test('limpiar: squash con rama remota viva → carpeta, rama local y rama remota borradas, con una sola consulta', () => {
  const m = mundo(['feat/uno']);
  const { carpeta, punta } = m.carpetas['feat/uno'];
  const { salida, llamadas } = correr(m, [pr(5, 'feat/uno', punta)]);
  assert.ok(!existsSync(carpeta));
  assert.ok(!ramasLocales(m).includes('feat/uno'));
  assert.ok(!ramasRemotas(m).includes('feat/uno'));
  assert.deepEqual(llamadas, ['api repos/o/r/pulls?state=closed&per_page=100']);
  assert.equal(salida.fallos, 0);
  assert.deepEqual(salida.borradas.map((b) => b.rama), ['feat/uno']);
});

test('limpiar: --ensayo dice qué borraría y no borra nada', () => {
  const m = mundo(['feat/uno']);
  const { carpeta, punta } = m.carpetas['feat/uno'];
  const { salida } = correr(m, [pr(5, 'feat/uno', punta)], { ensayo: true });
  assert.ok(existsSync(carpeta));
  assert.ok(ramasLocales(m).includes('feat/uno'));
  assert.ok(ramasRemotas(m).includes('feat/uno'));
  assert.deepEqual(salida.borradas.map((b) => b.rama), ['feat/uno']);
  assert.equal(salida.ensayo, true);
});

test('limpiar: un commit tras la fusión → se queda', () => {
  const m = mundo(['feat/dos']);
  const { carpeta, punta } = m.carpetas['feat/dos'];
  writeFileSync(path.join(carpeta, 'y.txt'), 'y\n');
  git(carpeta, 'add', 'y.txt');
  git(carpeta, 'commit', '-q', '-m', 'despues de fusionar');
  const { salida } = correr(m, [pr(6, 'feat/dos', punta)]);
  assert.ok(existsSync(carpeta));
  assert.ok(ramasRemotas(m).includes('feat/dos'));
  assert.match(salida.quedan.find((q) => q.rama === 'feat/dos').motivo, /punta/);
});

test('limpiar: carpeta sucia → se queda', () => {
  const m = mundo(['feat/tres']);
  const { carpeta, punta } = m.carpetas['feat/tres'];
  writeFileSync(path.join(carpeta, 'sin-guardar.txt'), 'x\n');
  const { salida } = correr(m, [pr(7, 'feat/tres', punta)]);
  assert.ok(existsSync(carpeta));
  assert.match(salida.quedan.find((q) => q.rama === 'feat/tres').motivo, /cambios sin guardar/);
});

test('limpiar: sin PR, o con PR cerrado sin fusionar → se queda', () => {
  const m = mundo(['feat/cuatro', 'feat/cinco']);
  const { salida } = correr(m, [pr(8, 'feat/cinco', m.carpetas['feat/cinco'].punta, false)]);
  assert.ok(existsSync(m.carpetas['feat/cuatro'].carpeta));
  assert.ok(existsSync(m.carpetas['feat/cinco'].carpeta));
  assert.equal(salida.quedan.length, 2);
  assert.ok(salida.quedan.every((q) => /fusionado/.test(q.motivo)));
});

test('limpiar: la carpeta principal no se toca aunque haya un PR fusionado con su punta', () => {
  const m = mundo([]);
  const { salida } = correr(m, [pr(9, 'main', git(m.principal, 'rev-parse', 'HEAD'))]);
  assert.ok(existsSync(m.principal));
  assert.deepEqual(salida.borradas, []);
});

test('limpiar: unión de node_modules → se quita la unión y el destino queda intacto', () => {
  const m = mundo(['feat/seis']);
  const { carpeta, punta } = m.carpetas['feat/seis'];
  const destino = path.join(m.padre, 'modulos-de-verdad');
  mkdirSync(destino);
  writeFileSync(path.join(destino, 'paquete.txt'), 'importante\n');
  symlinkSync(destino, path.join(carpeta, 'node_modules'), 'junction');
  correr(m, [pr(10, 'feat/seis', punta)]);
  assert.ok(!existsSync(carpeta));
  assert.equal(readFileSync(path.join(destino, 'paquete.txt'), 'utf8'), 'importante\n');
});

test('limpiar: si OTRA carpeta tiene una unión que apunta a esta, no se borra y se dice', () => {
  const m = mundo(['feat/siete', 'feat/ocho']);
  const { carpeta: a, punta } = m.carpetas['feat/siete'];
  const { carpeta: b } = m.carpetas['feat/ocho'];
  mkdirSync(path.join(a, 'node_modules'));
  writeFileSync(path.join(a, 'node_modules', 'paquete.txt'), 'importante\n');
  symlinkSync(path.join(a, 'node_modules'), path.join(b, 'node_modules'), 'junction');
  const { salida } = correr(m, [pr(11, 'feat/siete', punta)]);
  assert.ok(existsSync(path.join(a, 'node_modules', 'paquete.txt')));
  assert.match(salida.quedan.find((q) => q.rama === 'feat/siete').motivo, /unión de .*ocho/i);
});

test('limpiar: GitHub no responde → error y no se borra nada', () => {
  const m = mundo(['feat/nueve']);
  const { carpeta, punta } = m.carpetas['feat/nueve'];
  assert.throws(() => correr(m, [pr(12, 'feat/nueve', punta)], { falla: true }), /GitHub/);
  assert.ok(existsSync(carpeta));
  assert.ok(ramasLocales(m).includes('feat/nueve'));
  assert.ok(ramasRemotas(m).includes('feat/nueve'));
});

test('limpiar: lo que no pudo borrar se dice y cuenta como fallo, sin parar con las demás', () => {
  const m = mundo(['feat/diez', 'feat/once']);
  // Una carpeta bloqueada hace fallar git worktree remove: se dice y la otra se borra igual.
  git(m.principal, 'worktree', 'lock', m.carpetas['feat/diez'].carpeta);
  const prs = [pr(13, 'feat/diez', m.carpetas['feat/diez'].punta), pr(14, 'feat/once', m.carpetas['feat/once'].punta)];
  const { salida } = correr(m, prs);
  assert.equal(salida.fallos, 1);
  assert.ok(existsSync(m.carpetas['feat/diez'].carpeta));
  assert.ok(!existsSync(m.carpetas['feat/once'].carpeta));
  assert.match(salida.quedan.find((q) => q.rama === 'feat/diez').motivo, /no pude/);
});
