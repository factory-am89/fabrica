// scripts/medir-repo.mjs mide un repo ajeno con el juez de la Fábrica: GitHub grabada (fetch inyectado) y el claude falso, sin red ni modelo.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { armarCorpus, medir, ultimosFusionados, diffDe, resumir, formatear } from '../scripts/medir-repo.mjs';
import { cargarPreguntas } from '../scripts/veredicto.mjs';

const FALSO = path.join(import.meta.dirname, 'fixtures', 'claude-falso.mjs');
const REPO = 'dueno/repo';
const temporales = [];
after(() => temporales.forEach((d) => rmSync(d, { recursive: true, force: true })));
const temporal = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'medir-repo-test-'));
  temporales.push(d);
  return d;
};

// Respuesta grabada de GET /pulls?state=closed: 3 fusionados, uno cerrado sin fusionar, y el de número menor fusionado el último.
const LISTA = [
  { number: 104, title: 'cerrado sin fusionar', body: 'x', merged_at: null },
  { number: 103, title: 'tercero', body: null, merged_at: '2026-10-20T10:00:00Z' },
  { number: 102, title: 'segundo', body: 'cuerpo dos', merged_at: '2026-10-21T10:00:00Z' },
  { number: 101, title: 'primero', body: 'cuerpo uno', merged_at: '2026-10-22T10:00:00Z' },
];

function githubGrabada({ sinDiff = [], grandes = [] } = {}) {
  const pedidas = [];
  const fetchFn = async (url, opciones = {}) => {
    pedidas.push({ url, cabeceras: Object.keys(opciones.headers ?? {}) });
    const { pathname } = new URL(url);
    if (pathname === `/repos/${REPO}/pulls`) return new Response(JSON.stringify(LISTA), { status: 200 });
    const m = pathname.match(new RegExp(`^/repos/${REPO}/pulls/(\\d+)$`));
    if (m && opciones.headers.accept === 'application/vnd.github.diff') {
      if (grandes.includes(Number(m[1]))) return new Response('too big', { status: 406 });
      return sinDiff.includes(Number(m[1])) ? new Response('no', { status: 404 }) : new Response(`diff --git a/f${m[1]} b/f${m[1]}\n+linea ${m[1]}\n`, { status: 200 });
    }
    return new Response('no existe', { status: 404 });
  };
  return { fetchFn, pedidas };
}

test('elige los N fusionados más recientes por fecha de fusión y descarta el cerrado sin fusionar', async () => {
  const { fetchFn, pedidas } = githubGrabada();
  const prs = await ultimosFusionados(REPO, 2, fetchFn);
  assert.deepEqual(prs.map((p) => p.numero), [101, 102, 103], 'por fecha de fusión, con la holgura de candidatos');
  assert.equal(prs[0].cuerpo, 'cuerpo uno');
  assert.ok(pedidas.length > 0 && pedidas.every((p) => !p.cabeceras.includes('authorization')), 'sin credencial');
});

test('un diff de 406 se salta y se cuenta aparte; otro fallo lanza; si no se juntan los N, lanza', async () => {
  const prs = [101, 102, 103].map((numero) => ({ numero, titulo: `t${numero}`, cuerpo: '' }));
  const dir = temporal();
  const omitidos = await armarCorpus(REPO, prs, 2, dir, githubGrabada({ grandes: [101] }).fetchFn);
  assert.deepEqual(omitidos, [101]);
  assert.deepEqual(readdirSync(dir).sort(), ['pr-102', 'pr-103']);
  await assert.rejects(armarCorpus(REPO, prs, 2, temporal(), githubGrabada({ sinDiff: [101] }).fetchFn), /404/);
  await assert.rejects(armarCorpus(REPO, prs, 3, temporal(), githubGrabada({ grandes: [101] }).fetchFn), /solo se pudieron leer 2 diffs de 3 \(omitidos: 101\)/);
});

test('falla en alto: pide más PR de los que hay, repo mal escrito, diff que no se lee', async () => {
  const { fetchFn } = githubGrabada({ sinDiff: [101] });
  await assert.rejects(ultimosFusionados(REPO, 20, fetchFn), /solo hay 3 PR fusionados/);
  await assert.rejects(ultimosFusionados('sin-barra', 1, fetchFn), /dueño\/nombre/);
  await assert.rejects(diffDe(REPO, 101, fetchFn), /404/);
});

test('mide con el claude falso: un intento por PR, el impar dice «no» a C5, y la cifra sale por PR y por pregunta', async () => {
  const dir = temporal();
  const log = path.join(dir, 'claude.log');
  const previo = { b: process.env.GOLDEN_CLAUDE_BIN, l: process.env.CLAUDE_FALSO_LOG, a: process.env.CLAUDE_FALSO_ALTERNA };
  Object.assign(process.env, { GOLDEN_CLAUDE_BIN: FALSO, CLAUDE_FALSO_LOG: log, CLAUDE_FALSO_ALTERNA: '1' });
  try {
    const { fetchFn } = githubGrabada();
    const out = await medir({ repo: REPO, limit: 3, out: path.join(dir, 'medida'), fetchFn, log: () => {} });
    assert.match(out, /dueno\/repo#101: no \(C5\)/);
    assert.match(out, /dueno\/repo#102: sí/);
    assert.match(out, /dueno\/repo#103: no \(C5\)/);
    assert.match(out, /2 de 3 PR recibirían «no»/);
    assert.match(out, /preguntas con «no»: C5 \(2 PR\)/);
    const llamadas = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(llamadas.length, 3);
    // El juez ve el diff y el cuerpo del PR (título delante), y nada más del repo medido.
    const primera = llamadas.find((l) => l.stdin.includes('pr.diff'));
    assert.ok(primera.ficheros.includes('pr.diff') && primera.ficheros.includes('body.md'));
    assert.match(readFileSync(path.join(dir, 'medida', 'corpus', 'pr-103', 'body.md'), 'utf8'), /^# tercero\n\n/);
    assert.match(readFileSync(path.join(dir, 'medida', 'corpus', 'pr-101', 'pr.diff'), 'utf8'), /\+linea 101/);
  } finally {
    for (const [k, v] of [['GOLDEN_CLAUDE_BIN', previo.b], ['CLAUDE_FALSO_LOG', previo.l], ['CLAUDE_FALSO_ALTERNA', previo.a]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('una salida del juez ilegible, o ninguna, no cuenta como «sí»: resumir falla', () => {
  const preguntas = cargarPreguntas('standards/code.md');
  const vacio = temporal();
  assert.throws(() => resumir(vacio, preguntas), /ningún caso/);
  const roto = temporal();
  mkdirSync(path.join(roto, 'pr-1'));
  writeFileSync(path.join(roto, 'pr-1', '1.json'), 'esto no es json');
  assert.throws(() => resumir(roto, preguntas), /unreadable output: pr-1\/1\.json/);
});

test('formatear cuenta PR con «no» y las preguntas', () => {
  const texto = formatear({ casos: [{ id: 'pr-5', no: ['C5', 'C7'] }, { id: 'pr-6', no: [] }], conNo: 1, preguntas: { C5: 1, C7: 1 } }, REPO);
  assert.match(texto, /#5: no \(C5, C7\)/);
  assert.match(texto, /1 de 2 PR recibirían «no»/);
});
