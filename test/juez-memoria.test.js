// The judge with memory (Pablo, 2026-11-03, intervenciones.md): round 1 answers everything; from round 2 on a «no» is checked again,
// a «sí»/«no aplica» stays unless the new code touches a file its proof cited, and a new finding only fails the check when it is severe
// (GRAVE) with a ruta:línea; otherwise it is an aviso. The previous verdict is read only from the App's `revisor` check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { GRAVE, GRAVES, MAX_PROOF, MEMORY_FIELDS, buildRecord, cleanProof, extractRecord, formatBlock, parseRecord } from '../scripts/lib/record.mjs';
import { MOTIVO, candidates, citesTouched, filterDiff, previousRecord, readPrevious, touchedFiles } from '../scripts/lib/ronda.mjs';
import { buscarRonda } from '../scripts/veredicto.mjs';
import { REVISOR_APP_SLUG } from '../scripts/lib/repo.mjs';
import { buenas, ctx, esCheck, juzga, leer, SHA } from './apoyo/fabrica.mjs';

const ANTES = 'c'.repeat(40);
const ids = buenas().map((r) => r.id);
const [A, B, C] = ids;
// The round a round 2 reads: everything sí with a proof in x.js, except A, which was no.
const ronda2 = (extra = {}) => ({
  ronda: 2,
  sha: ANTES,
  answers: { ...Object.fromEntries(ids.map((id) => [id, 'sí'])), [A]: 'no' },
  pruebas: Object.fromEntries(ids.map((id) => [id, `scripts/x.mjs:${id.slice(1)}`])),
  tocados: [],
  ficheros: ['a.mjs', 'apps/web/nuevo.ts', 'db.mjs', 'scripts/x.mjs'],
  ...extra,
});
const con = (cambios) => buenas().map((r) => ({ ...r, ...(cambios[r.id] ?? {}) }));

test('ronda 1 (sin veredicto anterior): un no es un no, como siempre', () => {
  const v = juzga(con({ [B]: { respuesta: 'no' } }));
  assert.equal(v.ok, false);
  assert.deepEqual(v.fallos, [`${B}: no`]);
  assert.deepEqual(v.memoria, { ronda: 1, anterior: null, pruebas: Object.fromEntries(ids.map((id) => [id, 'x.js:1'])), avisos: [], graves: {} });
});

test('ronda 2: lo que fue no se vuelve a mirar; si sigue en no, sigue en rojo, y si se arregló, pasa', () => {
  assert.deepEqual(juzga(con({ [A]: { respuesta: 'no' } }), ctx({ anterior: ronda2() })).fallos, [`${A}: no`]);
  const arreglado = juzga(buenas(), ctx({ anterior: ronda2() }));
  assert.equal(arreglado.ok, true);
  assert.equal(arreglado.memoria.ronda, 2);
  assert.equal(arreglado.memoria.anterior, ANTES);
});

test('ronda 2: una pega nueva que no es grave es un aviso: no pone el check en rojo y su respuesta se queda en la de antes', () => {
  const v = juzga(con({ [A]: { respuesta: 'sí' }, [B]: { respuesta: 'no', prueba: 'lista copiada en a.mjs:3' } }), ctx({ anterior: ronda2() }));
  assert.equal(v.ok, true, v.fallos.join());
  assert.deepEqual(v.memoria.avisos, [B]);
  assert.equal(v.respuestas.answers[B], 'sí');
  assert.equal(v.memoria.pruebas[B], 'lista copiada en a.mjs:3');
});

test('ronda 2: una pega nueva grave, con ruta:línea, pone el check en rojo y dice cuál de las cuatro es', () => {
  for (const g of GRAVES) {
    const v = juzga(con({ [A]: { respuesta: 'sí' }, [B]: { respuesta: 'no', prueba: 'pisa la fila en db.mjs:40', grave: g } }), ctx({ anterior: ronda2() }));
    assert.equal(v.ok, false);
    assert.deepEqual(v.fallos, [`${B}: no (grave: ${g})`]);
    assert.deepEqual(v.memoria.graves, { [B]: g });
  }
});

test('ronda 2: una pega grave sin ruta:línea también para (falla en alto), y una «grave» fuera de la lista es un aviso', () => {
  const sinRuta = juzga(con({ [A]: { respuesta: 'sí' }, [B]: { respuesta: 'no', prueba: 'pierde datos en db.mjs', grave: GRAVE.data } }), ctx({ anterior: ronda2() }));
  assert.deepEqual(sinRuta.fallos, [`${B}: no (grave sin ruta:línea)`]);
  const inventada = juzga(con({ [A]: { respuesta: 'sí' }, [B]: { respuesta: 'no', prueba: 'a.mjs:1', grave: 'estilo' } }), ctx({ anterior: ronda2() }));
  assert.equal(inventada.ok, true);
  assert.deepEqual(inventada.memoria.avisos, [B]);
});

test('ronda 2: si el código nuevo toca un fichero que citaba la prueba de un sí, esa pregunta se juzga como en la ronda 1', () => {
  const anterior = ronda2({ tocados: ['scripts/x.mjs'] });
  const v = juzga(con({ [A]: { respuesta: 'sí' }, [B]: { respuesta: 'no' } }), ctx({ anterior }));
  assert.deepEqual(v.fallos, [`${B}: no`]);
  assert.deepEqual(v.memoria.avisos, []);
});

// Security review: a PR that opens with something trivial and pushes the real code later must not get that code judged for graves only.
test('ronda 2: una pega nueva sobre código nuevo (su prueba cita un fichero tocado) o que no cita ningún fichero es un no de siempre', () => {
  const anterior = ronda2({ tocados: ['apps/web/nuevo.ts'] });
  const sobreNuevo = juzga(con({ [A]: { respuesta: 'sí' }, [B]: { respuesta: 'no', prueba: 'lista copiada en apps/web/nuevo.ts:3' } }), ctx({ anterior }));
  assert.deepEqual(sobreNuevo.fallos, [`${B}: no`]);
  const sinFichero = juzga(con({ [A]: { respuesta: 'sí' }, [B]: { respuesta: 'no', prueba: 'falta una decisión' } }), ctx({ anterior }));
  assert.deepEqual(sinFichero.fallos, [`${B}: no`]);
  // Security review: a word with a dot is not a file. Only files of the PR count as cited.
  for (const prueba of ['falta comprobar res.ok antes de res.json() en el código nuevo', 'incumple standards/code.md:40']) {
    assert.deepEqual(juzga(con({ [A]: { respuesta: 'sí' }, [B]: { respuesta: 'no', prueba } }), ctx({ anterior })).fallos, [`${B}: no`], prueba);
  }
});

test('ronda 2: una pregunta sin respuesta anterior (nueva en el estándar) se juzga como en la ronda 1', () => {
  const anterior = ronda2();
  delete anterior.answers[C];
  assert.deepEqual(juzga(con({ [A]: { respuesta: 'sí' }, [C]: { respuesta: 'no' } }), ctx({ anterior })).fallos, [`${C}: no`]);
});

test('citesTouched: casa la ruta citada, con o sin carpetas, con letras como la ñ, y no otra', () => {
  assert.equal(citesTouched('planes/diseño.md:3', ['planes/diseño.md']), true);
  assert.equal(citesTouched('ver scripts/veredicto.mjs:12', ['scripts/veredicto.mjs']), true);
  assert.equal(citesTouched('veredicto.mjs:12 lo dice', ['scripts/veredicto.mjs']), true);
  assert.equal(citesTouched('ver scripts/otro.mjs:12', ['scripts/veredicto.mjs']), false);
  assert.equal(citesTouched('no aplica: no toca nada', ['scripts/veredicto.mjs']), false);
});

test('readPrevious: la ronda 1 lleva un motivo cerrado; la 2+ su sha, respuestas, pruebas y tocados; lo demás lanza', () => {
  assert.deepEqual(readPrevious(JSON.stringify({ ronda: 1, motivo: MOTIVO.old })), { ronda: 1, motivo: MOTIVO.old });
  assert.deepEqual(readPrevious(JSON.stringify(ronda2())), ronda2());
  for (const malo of ['{', '{"ronda":1}', '{"ronda":1,"motivo":"lo que diga el PR"}', JSON.stringify(ronda2({ sha: 'x' })), JSON.stringify(ronda2({ answers: { C5: 'quizá' } })), JSON.stringify(ronda2({ tocados: 'x' })), JSON.stringify(ronda2({ ficheros: undefined }))]) {
    assert.throws(() => readPrevious(malo), undefined, malo);
  }
});

test('candidates: solo la cabeza y la de antes del push; sin repetir y sin el sha nulo', () => {
  const s = (c) => c.repeat(40);
  assert.deepEqual(candidates(s('a'), s('b')), [s('a'), s('b')]);
  assert.deepEqual(candidates(s('a'), s('0')), [s('a')]);
  assert.deepEqual(candidates(s('a'), ''), [s('a')]);
  assert.deepEqual(candidates(s('a'), s('a')), [s('a')]);
});

test('touchedFiles: lo que solo cambió la base no está; lo que cambió el PR, lo nuevo y lo que dejó de estar, sí', () => {
  const antes = [{ filename: 'a', status: 'modified', sha: '1' }, { filename: 'b', status: 'modified', sha: '2' }, { filename: 'c', status: 'added', sha: '3' }];
  const ahora = [{ filename: 'a', status: 'modified', sha: '1' }, { filename: 'b', status: 'modified', sha: '9' }, { filename: 'd', status: 'added', sha: '4' }];
  assert.deepEqual(touchedFiles(antes, ahora), ['b', 'c', 'd']);
});

test('filterDiff: se queda solo con los ficheros tocados', () => {
  const diff = 'diff --git a/x b/x\n+1\ndiff --git a/y b/y\n+2\n';
  assert.equal(filterDiff(diff, ['y']), 'diff --git a/y b/y\n+2\n');
  assert.equal(filterDiff(diff, []), '');
});

const registro = (extra = {}) => buildRecord({
  repo: 'o/r', pr: 2, sha: ANTES, standard: 'standards/code.md', veredicto: { ok: false },
  respuestas: { answers: { C5: 'no' }, invalid: 0 }, run: null,
  memoria: { ronda: 1, anterior: null, pruebas: { C5: 'a.mjs:1' }, avisos: [], graves: {} }, ...extra,
});
const checkCon = (id, r, extra = {}) => ({ id, status: 'completed', conclusion: 'failure', app: { slug: REVISOR_APP_SLUG }, output: { title: 'Veredicto: no', text: formatBlock(r) }, ...extra });

test('previousRecord: el registro más nuevo de ESTE PR, sin error; salta los checks sin registro, de otro PR o en curso', () => {
  const otroPr = registro({ pr: 3 });
  const conError = buildRecord({ repo: 'o/r', pr: 2, sha: ANTES, standard: null, veredicto: { ok: false }, respuestas: { answers: {}, invalid: 0 }, run: null, error: 'output-unreadable' });
  const bueno = registro();
  const checks = [{ id: 9, status: 'in_progress', output: { title: 'juzgando' } }, checkCon(8, otroPr), checkCon(7, conError), { id: 6, status: 'completed', output: { title: 'override by x' } }, checkCon(5, bueno)];
  assert.deepEqual(previousRecord(checks, { repo: 'o/r', pr: '2' }), bueno);
  assert.equal(previousRecord([checkCon(1, otroPr)], { repo: 'o/r', pr: '2' }), null);
  const sinTexto = { id: 4, status: 'completed', conclusion: 'failure', output: { title: 'Veredicto: no', summary: '- el juez falló antes de dar veredicto' } };
  const cortado = { id: 3, status: 'completed', conclusion: 'failure', output: { title: 'juicio cortado', text: 'x' } };
  assert.deepEqual(previousRecord([sinTexto, cortado, checkCon(2, bueno)], { repo: 'o/r', pr: '2' }), bueno);
});

// The reviewer of #202 (C5): a check of the App with a record that does not read is not «no previous verdict» in silence.
test('previousRecord: un check de la App con un registro que no se lee lanza (buscarRonda lo convierte en ronda 1 con su motivo)', async () => {
  const roto = { id: 9, status: 'completed', conclusion: 'success', output: { title: 'Veredicto: sí', text: '```json\n{"v":9}\n```' } };
  assert.throws(() => previousRecord([roto, checkCon(5, registro())], { repo: 'o/r', pr: '2' }), /record/);
  await assert.rejects(conGitHubFalsa({ checks: { [SHA]: [{ ...roto, app: { slug: REVISOR_APP_SLUG } }] } }, busca).then((x) => x.r), /record/);
});

test('registro: la memoria va entera o no va; las pruebas, limpias; las graves, de la lista cerrada', () => {
  const r = registro();
  assert.deepEqual(parseRecord(JSON.stringify(r)), r);
  const sinMemoria = Object.fromEntries(Object.entries(r).filter(([k]) => !MEMORY_FIELDS.includes(k)));
  assert.deepEqual(parseRecord(JSON.stringify(sinMemoria)), sinMemoria, 'un registro de antes de la memoria se sigue leyendo');
  assert.throws(() => parseRecord(JSON.stringify({ ...sinMemoria, ronda: 1 })), /all or none/);
  assert.throws(() => parseRecord(JSON.stringify({ ...r, pruebas: { C5: 'ghp_abcdefghijklmnopqrstuvwxyz0123' } })), /not clean/);
  assert.throws(() => parseRecord(JSON.stringify({ ...r, ronda: 2, anterior: SHA, graves: { C5: 'estilo' } })), /grave/);
  assert.throws(() => parseRecord(JSON.stringify({ ...r, avisos: ['C5'] })), /round 1/);
  assert.equal(cleanProof('a\n```json\nb'), "a 'json b");
  assert.equal(cleanProof('y'.repeat(2000)).length <= MAX_PROOF, true);
  const larga = 'apps/menuplan-web/src/components/recipe-editor-panel/RecipeEditor.tsx:12';
  assert.equal(cleanProof(larga), larga, 'una ruta larga no es una clave');
  assert.equal(cleanProof(`${'Q'.repeat(60)}.tsx`), '[quitado].tsx', 'sin carpetas no es una ruta');
  const prueba = 'mira <!-- [ok](http://x) a.mjs:1';
  assert.equal(cleanProof(cleanProof(prueba)), cleanProof(prueba));
  // Security review: a cut right before the «.» of a long path left a proof a second pass would change; the record rejects those.
  const cortada = `${"x ".repeat(470)}${'apps/menuplan-web/src/components/recipe-editor/'}RecipeEditor.tsx:1`;
  assert.equal(cleanProof(cleanProof(cortada)), cleanProof(cortada));
  for (let n = MAX_PROOF - 100; n < MAX_PROOF + 20; n += 1) {
    const t = `${'y'.repeat(n)} apps/menuplan-web/src/components/recipe-editor/RecipeEditor.tsx:1`;
    assert.equal(cleanProof(cleanProof(t)), cleanProof(t), String(n));
  }
});

// buscarRonda with the GitHub API faked in-process: check-runs per sha, the PR's commits, the compares and the incremental diff.
async function conGitHubFalsa(datos, fn) {
  const real = globalThis.fetch;
  const pedidas = [];
  globalThis.fetch = async (url, opciones = {}) => {
    const { pathname, searchParams } = new URL(url);
    pedidas.push(`${pathname}${opciones.headers?.accept === 'application/vnd.github.diff' ? ' (diff)' : ''}`);
    const m = pathname.match(/^\/repos\/o\/r\/commits\/([0-9a-f]{40})\/check-runs$/);
    if (m) return Response.json({ check_runs: datos.checks[m[1]] ?? [] });
    if (pathname === '/repos/o/r/pulls/2/commits') return Response.json(searchParams.get('page') === '1' ? (datos.commits ?? []).map((sha) => ({ sha })) : []);
    const cmp = pathname.match(/^\/repos\/o\/r\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/);
    if (cmp && opciones.headers?.accept === 'application/vnd.github.diff') return new Response(datos.diff ?? '');
    if (cmp) return Response.json({ files: searchParams.get('page') === '1' ? datos.files[cmp[2]] : [] });
    return new Response('no', { status: 404 });
  };
  try {
    return { r: await fn(), pedidas };
  } finally {
    globalThis.fetch = real;
  }
}
const BASE = 'b'.repeat(40);
process.env.REVISOR_APP_SLUG = REVISOR_APP_SLUG;
const busca = (extra = {}) => buscarRonda({ repo: 'o/r', pr: '2', sha: SHA, base: BASE, antes: ANTES, token: 't', ...extra });

test('buscarRonda: sin veredicto de la App es ronda 1; un registro sin memoria (juez de antes), también', async () => {
  assert.deepEqual((await conGitHubFalsa({ checks: {} }, busca)).r.anterior, { ronda: 1, motivo: MOTIVO.none });
  const viejo = registro();
  for (const k of MEMORY_FIELDS) delete viejo[k];
  const { r } = await conGitHubFalsa({ checks: { [ANTES]: [checkCon(5, viejo)] }, commits: [ANTES, SHA] }, busca);
  assert.deepEqual(r.anterior, { ronda: 1, motivo: MOTIVO.old });
});

test('buscarRonda: un registro con la forma buena pero publicado por otra App (o por quien abre el PR) nunca es el veredicto anterior', async () => {
  const falso = checkCon(5, registro({ ok: true, respuestas: { answers: { C5: 'sí' }, invalid: 0 } }), { app: { slug: 'otra-app' } });
  const { r } = await conGitHubFalsa({ checks: { [ANTES]: [falso] }, commits: [ANTES, SHA] }, busca);
  assert.deepEqual(r.anterior, { ronda: 1, motivo: MOTIVO.none });
});

test('buscarRonda: con un veredicto anterior, la ronda siguiente, sus respuestas y pruebas, los tocados y el diff incremental de solo esos ficheros', async () => {
  const files = {
    [ANTES]: [{ filename: 'a.mjs', status: 'modified', sha: '1' }, { filename: 'b.mjs', status: 'modified', sha: '2' }],
    [SHA]: [{ filename: 'a.mjs', status: 'modified', sha: '1' }, { filename: 'b.mjs', status: 'modified', sha: '7' }],
  };
  const diff = 'diff --git a/b.mjs b/b.mjs\n+arreglo\ndiff --git a/de-la-base.mjs b/de-la-base.mjs\n+main\n';
  const { r, pedidas } = await conGitHubFalsa({ checks: { [ANTES]: [checkCon(5, registro())] }, commits: [ANTES, SHA], files, diff }, busca);
  assert.deepEqual(r.anterior, { ronda: 2, sha: ANTES, answers: { C5: 'no' }, pruebas: { C5: 'a.mjs:1' }, tocados: ['b.mjs'], ficheros: ['a.mjs', 'b.mjs'] });
  assert.equal(r.diff, 'diff --git a/b.mjs b/b.mjs\n+arreglo\n');
  assert.deepEqual(readPrevious(JSON.stringify(r.anterior)), r.anterior);
  assert.ok(pedidas.includes(`/repos/o/r/compare/${ANTES}...${SHA} (diff)`));
});

// Security review: a verdict on an older commit is never the previous one. Otherwise: round 1 on A says sí, round 2 on B says no;
// draft, force-push C onto A without B, ready_for_review (no «before»): the no of B would be forgotten.
test('buscarRonda: un veredicto en un commit que no es la cabeza ni la de antes del push no cuenta; ronda 1', async () => {
  const { r, pedidas } = await conGitHubFalsa({ checks: { [ANTES]: [checkCon(5, registro())] }, commits: [ANTES, SHA] }, () => busca({ antes: '' }));
  assert.deepEqual(r.anterior, { ronda: 1, motivo: MOTIVO.none });
  assert.ok(!pedidas.some((x) => x.endsWith('/pulls/2/commits')), 'no se buscan los commits del PR');
});

test('buscarRonda: el cuerpo editado (misma cabeza) es ronda 2 sin tocados ni diff', async () => {
  const { r } = await conGitHubFalsa({ checks: { [SHA]: [checkCon(5, registro({ sha: SHA }))] }, commits: [SHA], files: { [SHA]: [{ filename: 'a.mjs', status: 'modified', sha: '1' }] } }, busca);
  assert.deepEqual({ ronda: r.anterior.ronda, tocados: r.anterior.tocados, diff: r.diff }, { ronda: 2, tocados: [], diff: '' });
});

// scripts/preparar-ronda.mjs end to end: if the API fails it is a round 1 with its closed reason (the strictest), said in the log, never a
// crash. CHECKS_FALSOS that is not a list makes the fake GitHub throw inside fetch, like a network error.
test('preparar-ronda: si la API falla, deja ronda 1 con el motivo cerrado en anterior.json y en la salida del paso, y lo avisa', () => {
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const tmp = spawnSync(process.execPath, ['-e', 'console.log(require("fs").mkdtempSync(require("path").join(require("os").tmpdir(),"ronda-")))'], { encoding: 'utf8' }).stdout.trim();
  const precarga = pathToFileURL(`${dir}fixtures/github-falso.mjs`).href;
  const salida = `${tmp}/github-output`;
  const r = spawnSync(process.execPath, ['--import', precarga, fileURLToPath(new URL('../scripts/preparar-ronda.mjs', import.meta.url))], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, REPO: 'o/r', REVISOR_APP_SLUG, PR: '2', SHA, BASE, LECTOR: 'falso', RUNNER_TEMP: tmp, GITHUB_OUTPUT: salida, CHECKS_FALSOS: '{}' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /::warning::no se pudo leer el veredicto anterior/);
  const linea = JSON.stringify({ ronda: 1, motivo: MOTIVO.unreadable });
  assert.equal(leerFichero(salida), `anterior=${linea}\n`);
  assert.equal(leerFichero(`${tmp}/anterior.json`), `${linea}\n`);
  assert.equal(leerFichero(`${tmp}/incremental.diff`), '');
});
const leerFichero = (ruta) => spawnSync(process.execPath, ['-e', `process.stdout.write(require("fs").readFileSync(${JSON.stringify(ruta)},"utf8"))`], { encoding: 'utf8' }).stdout;

// The verdict step reads the round from ANTERIOR (the output of the ronda step) and shows the avisos in the check text, not the summary.
test('veredicto de punta a punta: en ronda 2 un aviso deja el check en verde, aprueba y lo enseña en el texto, con su prueba', () => {
  const precarga = pathToFileURL(fileURLToPath(new URL('./fixtures/github-falso.mjs', import.meta.url))).href;
  const respuestas = con({ [A]: { respuesta: 'sí' }, [B]: { respuesta: 'no', prueba: 'copia de la lista en a.mjs:3' } });
  const r = spawnSync(process.execPath, ['--import', precarga, fileURLToPath(new URL('../scripts/veredicto.mjs', import.meta.url))], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, REPO: 'o/r', REVISOR_APP_SLUG, PR: '2', SHA, BASE, TOKEN: 'falso', LECTOR: 'falso', CHECK_RUN: '4242', STANDARD: 'standards/code.md', SALIDA: JSON.stringify({ respuestas }), ANTERIOR: JSON.stringify(ronda2()) },
  });
  assert.equal(r.status, 0, r.stderr);
  const publicado = r.stderr.split('\n').filter((l) => l.startsWith('PUBLICADO ')).map((l) => JSON.parse(l.slice(10)));
  const c = publicado.find((p) => esCheck(p)).cuerpo;
  assert.equal(c.conclusion, 'success');
  assert.ok(publicado.some((p) => p.ruta.endsWith('/reviews')), 'un aviso no quita la aprobación');
  assert.ok(c.output.text.startsWith(`Ronda 2, sobre el veredicto anterior de ${ANTES}.\n\nAvisos (pegas nuevas que no son graves; no ponen el check en rojo):\n- ${B}: \`copia de la lista en a.mjs:3\`\n`), c.output.text);
  assert.deepEqual(extractRecord(c.output.text).avisos, [B]);
  assert.doesNotMatch(c.output.summary, /aviso/i, 'el resumen (lo que anula un dueño) no lleva avisos');
  const malo = spawnSync(process.execPath, ['--import', precarga, fileURLToPath(new URL('../scripts/veredicto.mjs', import.meta.url))], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, REPO: 'o/r', REVISOR_APP_SLUG, PR: '2', SHA, BASE, TOKEN: 'falso', LECTOR: 'falso', CHECK_RUN: '4242', STANDARD: 'standards/code.md', SALIDA: JSON.stringify({ respuestas }), ANTERIOR: '{"ronda":3}' },
  });
  assert.equal(malo.status, 1, 'una ronda mal formada falla en alto');
  const cerrado = malo.stderr.split('\n').filter((l) => l.startsWith('PUBLICADO ')).map((l) => JSON.parse(l.slice(10))).find((p) => esCheck(p)).cuerpo;
  assert.equal(cerrado.conclusion, 'failure');
});

// The workflow: the round is prepared before Claude, with the read-only token, and reaches the verdict only as that step's output.
test('revisor.yml: el paso de la ronda va antes de Claude, con el token de solo lectura, y el veredicto lee su salida', () => {
  const pasos = yaml.load(leer('.github/workflows/revisor.yml')).jobs.juzgar.steps;
  const iRonda = pasos.findIndex((p) => p.id === 'ronda');
  const iClaude = pasos.findIndex((p) => p.id === 'claude');
  assert.ok(iRonda >= 0 && iRonda < iClaude, 'la ronda se prepara antes de Claude');
  const ronda = pasos[iRonda];
  assert.equal(ronda.run, 'node .fabrica/scripts/preparar-ronda.mjs');
  assert.equal(ronda.env.LECTOR, '${{ github.token }}');
  assert.ok(!JSON.stringify(ronda).includes('steps.app'), 'la ronda no ve el token de la App');
  const veredicto = pasos.find((p) => String(p.run ?? '').includes('veredicto.mjs'));
  assert.equal(veredicto.env.ANTERIOR, '${{ steps.ronda.outputs.anterior }}');
  const args = pasos[iClaude].with.claude_args;
  const esquema = JSON.parse(args.match(/--json-schema '([^']*)'/)[1]);
  assert.deepEqual(esquema.properties.respuestas.items.properties.grave.enum, GRAVES, 'el esquema y la lista cerrada de record.mjs dicen las mismas graves');
  assert.deepEqual(esquema.properties.respuestas.items.required, ['id', 'respuesta', 'prueba'], 'grave es opcional');
  assert.match(pasos[iClaude].with.prompt, /anterior\.json/);
  assert.match(pasos[iClaude].with.prompt, /incremental\.diff/);
});
