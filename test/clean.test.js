// La limpieza mira el PR fusionado en GitHub (no la ascendencia): squash, punta, sucia, unión, GitHub caído.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearTarea } from '../scripts/tarea.mjs';
import { limpiar, opciones, imprimir } from '../scripts/clean.mjs';
import { leerFicha } from '../scripts/lib/repo-card.mjs';
import { IDENTIDADES, identidadDe } from '../scripts/lib/identities.mjs';
import { consultar, rutaDe } from '../scripts/lib/gh-public.mjs';
import { REPO } from '../scripts/lib/repo.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FALSO = path.join(AQUI, 'fixtures', 'token-falso.mjs');

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

// Los nombres de identidad salen del mapa, no se escriben a mano.
const CON_ESCRITURA = Object.keys(IDENTIDADES).find((n) => IDENTIDADES[n].borraRemotas);
const SIN_ESCRITURA = Object.keys(IDENTIDADES).find((n) => !IDENTIDADES[n].borraRemotas);
const FICHA = { repo: 'factory-am89/r', base: 'main', identidad: CON_ESCRITURA };

// <tmp>/fabrica con origin local y una carpeta por rama, cada una con un commit ya subido.
// `ficha`: lo que se escribe en .fabrica.json (null: sin ficha). `conStaging`: origin también tiene la rama staging.
function mundo(ramas, { ficha = FICHA, conStaging = false } = {}) {
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
  if (conStaging) git(principal, 'push', '-q', 'origin', 'main:staging');
  // tarea lee la rama base de la ficha: las carpetas se crean con la ficha común y después se pone la que se prueba
  writeFileSync(path.join(principal, '.fabrica.json'), JSON.stringify(FICHA));
  const carpetas = {};
  for (const rama of ramas) {
    const { carpeta } = crearTarea(rama, { cwd: principal, instalar: false });
    writeFileSync(path.join(carpeta, 'x.txt'), `${rama}\n`);
    git(carpeta, 'add', 'x.txt');
    git(carpeta, 'commit', '-q', '-m', rama);
    git(carpeta, 'push', '-q', 'origin', rama);
    carpetas[rama] = { carpeta, punta: git(carpeta, 'rev-parse', 'HEAD') };
  }
  if (ficha) writeFileSync(path.join(principal, '.fabrica.json'), JSON.stringify(ficha));
  else rmSync(path.join(principal, '.fabrica.json'));
  return { padre, principal, remoto, carpetas };
}

const pr = (numero, rama, sha, fusionado = true, base = 'main') => ({
  number: numero, merged_at: fusionado ? '2026-10-16T10:00:00Z' : null, head: { ref: rama, sha }, base: { ref: base },
});

function correr(m, prs, { ensayo = false, falla = false } = {}) {
  const prsFichero = path.join(m.padre, 'prs.json');
  const log = path.join(m.padre, 'llamadas.log');
  writeFileSync(prsFichero, JSON.stringify(prs));
  process.env.FALSO_PRS = prsFichero;
  process.env.FALSO_LOG = log;
  if (falla) process.env.FALSO_FALLA = '1';
  else delete process.env.FALSO_FALLA;
  const salida = limpiar({ cwd: m.principal, ensayo, token: FALSO });
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
  assert.deepEqual(llamadas, ['api repos/factory-am89/r/pulls?state=closed&per_page=100']);
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

test('limpiar: si git branch -D falla tras borrar la carpeta, el informe dice lo que pasó (borrada, con aviso), no «se queda»', () => {
  const m = mundo(['feat/doce']);
  const { carpeta, punta } = m.carpetas['feat/doce'];
  // Un .lock en la rama hace fallar git branch -D después de que worktree remove haya borrado la carpeta.
  const lock = path.join(git(m.principal, 'rev-parse', '--git-common-dir'), 'refs', 'heads', 'feat', 'doce.lock');
  writeFileSync(path.resolve(m.principal, lock), '');
  const { salida } = correr(m, [pr(15, 'feat/doce', punta)]);
  assert.ok(!existsSync(carpeta));
  assert.equal(salida.quedan.length, 0);
  assert.equal(salida.borradas.length, 1);
  assert.match(salida.borradas[0].avisos.join('\n'), /rama local/);
  assert.equal(salida.fallos, 1);
  assert.ok(!ramasRemotas(m).includes('feat/doce'), 'la rama remota se borra igualmente');
});

test('limpiar: sucia y además sin PR fusionado → el motivo que se dice es el de cambios sin guardar (orden de la regla común)', () => {
  const m = mundo(['feat/trece']);
  writeFileSync(path.join(m.carpetas['feat/trece'].carpeta, 'sin-guardar.txt'), 'x\n');
  const { salida } = correr(m, []);
  assert.match(salida.quedan.find((q) => q.rama === 'feat/trece').motivo, /cambios sin guardar/);
});

// ── Una sola limpieza para cualquier repo: la ficha .fabrica.json ─────────────────────────────────

const identidadGit = (cwd) => { for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['commit.gpgsign', 'false']]) git(cwd, 'config', k, v); };

test('limpiar: dos repos distintos (merge a base staging, squash a main) → borra lo fusionado en los dos', () => {
  const a = mundo(['feat/aa'], { ficha: { repo: 'factory-am89/staging', base: 'staging', identidad: CON_ESCRITURA }, conStaging: true });
  const b = mundo(['feat/bb']);
  // a: fusión con merge de verdad en origin/staging; b: squash en origin/main (la rama NO queda contenida).
  const clonA = path.join(a.padre, 'clon');
  git(a.padre, 'clone', '-q', '-b', 'staging', a.remoto, clonA);
  identidadGit(clonA);
  git(clonA, 'fetch', '-q', 'origin', 'feat/aa');
  git(clonA, 'merge', '-q', '--no-ff', '-m', 'merge', 'origin/feat/aa');
  git(clonA, 'push', '-q', 'origin', 'staging');
  const clonB = path.join(b.padre, 'clon');
  git(b.padre, 'clone', '-q', b.remoto, clonB);
  identidadGit(clonB);
  writeFileSync(path.join(clonB, 'x.txt'), 'feat/bb\n');
  git(clonB, 'add', 'x.txt');
  git(clonB, 'commit', '-q', '-m', 'squash de feat/bb');
  git(clonB, 'push', '-q', 'origin', 'main');
  git(b.principal, 'fetch', '-q', 'origin');
  assert.notEqual(spawnSync('git', ['merge-base', '--is-ancestor', 'feat/bb', 'origin/main'], { cwd: b.principal }).status, 0, 'el squash no deja la rama contenida');
  const ra = correr(a, [pr(1, 'feat/aa', a.carpetas['feat/aa'].punta, true, 'staging')]);
  const rb = correr(b, [pr(2, 'feat/bb', b.carpetas['feat/bb'].punta)]);
  for (const [m, rama, r] of [[a, 'feat/aa', ra], [b, 'feat/bb', rb]]) {
    assert.ok(!existsSync(m.carpetas[rama].carpeta), `${rama}: carpeta borrada`);
    assert.ok(!ramasLocales(m).includes(rama), `${rama}: rama local borrada`);
    assert.ok(!ramasRemotas(m).includes(rama), `${rama}: rama remota borrada`);
    assert.equal(r.salida.fallos, 0);
  }
  assert.deepEqual(ra.llamadas, ['api repos/factory-am89/staging/pulls?state=closed&per_page=100']);
});

test('limpiar: un PR fusionado en OTRA rama que la base de la ficha no cuenta → se queda', () => {
  const m = mundo(['feat/cc'], { ficha: { ...FICHA, base: 'staging' } });
  const { salida } = correr(m, [pr(3, 'feat/cc', m.carpetas['feat/cc'].punta, true, 'main')]);
  assert.ok(existsSync(m.carpetas['feat/cc'].carpeta));
  assert.match(salida.quedan[0].motivo, /no está fusionada/);
});

test('limpiar: sin ficha → error que nombra la ficha y no se borra nada', () => {
  const m = mundo(['feat/dd'], { ficha: null });
  const { carpeta, punta } = m.carpetas['feat/dd'];
  assert.throws(() => correr(m, [pr(4, 'feat/dd', punta)]), /Falta la ficha .*\.fabrica\.json/);
  assert.ok(existsSync(carpeta));
  assert.ok(ramasLocales(m).includes('feat/dd'));
  assert.ok(ramasRemotas(m).includes('feat/dd'));
});

test('ficha: incompleta, con claves de más, identidad desconocida o no JSON → error (sin valores por defecto)', () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'ficha-')));
  const con = (contenido) => {
    writeFileSync(path.join(dir, '.fabrica.json'), typeof contenido === 'string' ? contenido : JSON.stringify(contenido));
    return () => leerFicha(dir);
  };
  assert.deepEqual(con(FICHA)(), FICHA);
  assert.throws(con({ repo: 'o/r', base: 'main' }), /no tiene «identidad»/);
  assert.throws(con({ ...FICHA, base: '' }), /no tiene «base»/);
  assert.throws(con({ ...FICHA, repo: 'sin-barra' }), /owner\/name/);
  assert.throws(con({ ...FICHA, extra: 1 }), /claves que no conozco: extra/);
  assert.throws(con({ ...FICHA, identidad: 'pablo' }), /«identidad» debe ser una de/);
  assert.throws(con('{no es json'), /no es JSON legible/);
  assert.throws(con('[]'), /debe ser un objeto/);
  // Cada identidad del mapa: con dueño fijo, otro dueño se rechaza; sin dueño fijo, vale cualquiera.
  for (const [nombre, { duenos }] of Object.entries(IDENTIDADES)) {
    const otra = { repo: 'otro-dueno/r', base: 'main', identidad: nombre };
    if (duenos) assert.throws(con(otra), /solo vale en repos de/, nombre);
    else assert.deepEqual(con(otra)(), otra, nombre);
  }
});

test('ficha: la de esta Fábrica existe, es válida y dice el mismo repo que scripts/lib/repo.mjs', () => {
  const f = leerFicha(path.join(AQUI, '..'));
  assert.equal(f.repo, REPO);
  assert.equal(f.identidad, CON_ESCRITURA);
});

test('identidad «ninguna»: borra carpeta y rama local, NO toca la rama remota y lo dice', () => {
  const m = mundo(['feat/ee'], { ficha: { repo: 'o/publico', base: 'main', identidad: SIN_ESCRITURA } });
  const { carpeta, punta } = m.carpetas['feat/ee'];
  const { salida } = correr(m, [pr(5, 'feat/ee', punta)]);
  assert.ok(!existsSync(carpeta));
  assert.ok(!ramasLocales(m).includes('feat/ee'));
  assert.ok(ramasRemotas(m).includes('feat/ee'));
  assert.equal(salida.fallos, 0);
  const lineas = [];
  imprimir(salida, (l) => lineas.push(l));
  assert.ok(lineas.some((l) => /o\/publico no tiene identidad de escritura/.test(l)), lineas.join('\n'));
  assert.ok(!lineas.some((l) => /y su rama remota/.test(l)));
});

test('--repo: se puede lanzar desde fuera de la carpeta del repo', () => {
  const m = mundo(['feat/ff']);
  const { carpeta, punta } = m.carpetas['feat/ff'];
  const fuera = realpathSync(mkdtempSync(path.join(tmpdir(), 'fuera-')));
  const { repoDir } = opciones(['--repo', m.principal]);
  writeFileSync(path.join(m.padre, 'prs.json'), JSON.stringify([pr(6, 'feat/ff', punta)]));
  process.env.FALSO_PRS = path.join(m.padre, 'prs.json');
  delete process.env.FALSO_FALLA;
  const salida = limpiar({ cwd: fuera, repoDir, token: FALSO });
  assert.ok(!existsSync(carpeta));
  assert.equal(salida.borradas.length, 1);
});

test('opciones: --repo y --ficha piden valor y un argumento desconocido es un error', () => {
  assert.deepEqual(opciones([]), { ensayo: false });
  assert.equal(opciones(['--ensayo']).ensayo, true);
  assert.equal(opciones(['--ficha', 'x.json']).fichero, path.resolve('x.json'));
  assert.throws(() => opciones(['--repo']), /necesita un valor/);
  assert.throws(() => opciones(['--repo', '--ensayo']), /necesita un valor/);
  assert.throws(() => opciones(['--borra']), /argumento desconocido/);
});

test('identidad: cada una del mapa tiene un lanzador que existe y dice si borra ramas remotas; una desconocida lanza', () => {
  assert.ok(CON_ESCRITURA && SIN_ESCRITURA, 'el mapa tiene una con escritura y una sin ella');
  for (const nombre of Object.keys(IDENTIDADES)) {
    const { lanzador, borraRemotas } = identidadDe(nombre);
    assert.ok(existsSync(lanzador), `${nombre}: ${lanzador} existe`);
    assert.equal(typeof borraRemotas, 'boolean', nombre);
  }
  assert.throws(() => identidadDe('pablo'), /desconocida/);
  assert.throws(() => identidadDe('toString'), /desconocida/);
});

test('gh-publico: pide la URL pública sin cabecera de autorización, solo acepta «gh api <ruta>» y falla en alto', async () => {
  const visto = [];
  const ok = async (url, o) => (visto.push({ url, cabeceras: Object.keys(o.headers) }), new Response('[1]', { status: 200 }));
  assert.equal(await consultar('repos/o/r/pulls?state=closed', ok), '[1]');
  assert.equal(visto[0].url, 'https://api.github.com/repos/o/r/pulls?state=closed');
  assert.ok(!visto[0].cabeceras.some((c) => /authorization/i.test(c)));
  await assert.rejects(consultar('repos/o/r/pulls', async () => new Response('no', { status: 403 })), /403.*límite/);
  assert.equal(rutaDe(['--', 'gh', 'api', 'repos/o/r']), 'repos/o/r');
  assert.throws(() => rutaDe(['--', 'git', 'push']), /Sin credencial/);
  assert.throws(() => rutaDe(['--', 'gh', 'api', 'a', 'b']), /Sin credencial/);
  assert.throws(() => rutaDe(['gh', 'api', 'a']), /Sin credencial/);
});
