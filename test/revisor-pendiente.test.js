// lesson: required-check-stale-while-rejudged
// lesson: in-progress-closed-by-job-that-may-not-run
// El check obligatorio `revisor` pasa a «juzgando» (in_progress) al empezar cada juicio y el veredicto cierra ESE check (issue #155,
// plans/revisor-pendiente.md, trozo 4). Sin eso, editar el cuerpo de un PR con un «sí» viejo dejaba fusionar mientras se volvía a juzgar.
// VEREDICTO_RUTA apunta el script a otra copia (para ver el caso malo en rojo con el veredicto.mjs de main).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { PENDING_TITLE, overrideTitle, CUT_TITLE, readCheckRuns, extractRecord } from '../scripts/lib/record.mjs';
import { TITULO } from '../scripts/veredicto.mjs';
import { OWNER_LOGIN, REVISOR_APP_SLUG, REPO } from '../scripts/lib/repo.mjs';
import { buenas, SHA, leer, esCheck } from './apoyo/fabrica.mjs';

const corre = (extra) => {
  const ruta = process.env.VEREDICTO_RUTA ?? fileURLToPath(new URL('../scripts/veredicto.mjs', import.meta.url));
  const precarga = pathToFileURL(fileURLToPath(new URL('./fixtures/github-falso.mjs', import.meta.url))).href;
  const salida = path.join(mkdtempSync(path.join(tmpdir(), 'pendiente-')), 'github-output');
  const r = spawnSync(process.execPath, ['--import', precarga, ruta], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, REPO: 'o/r', REVISOR_APP_SLUG, PR: '2', SHA, BASE: 'b'.repeat(40), TOKEN: 'falso', LECTOR: 'falso', GITHUB_OUTPUT: salida, RUN_ID: '777', ...extra },
  });
  const publicado = r.stderr.split('\n').filter((l) => l.startsWith('PUBLICADO ')).map((l) => JSON.parse(l.slice(10)));
  const checks = publicado.filter((p) => esCheck(p));
  return { r, publicado, checks, salida };
};
const juzga = (extra = {}) => corre({ STANDARD: 'standards/code.md', SALIDA: JSON.stringify({ respuestas: buenas() }), CHECK_RUN: '4242', ...extra });
const deLaApp = (id, extra = {}) => ({ id, status: 'completed', conclusion: 'success', app: { slug: REVISOR_APP_SLUG }, output: { title: TITULO.yes, summary: 'x' }, ...extra });
const salidaNo = JSON.stringify({ respuestas: buenas().map((r, i) => (i === 0 ? { ...r, respuesta: 'no' } : r)) });

test('MODO=pendiente: publica `revisor` in_progress con el título PENDING_TITLE, sin conclusión, y deja su id como salida del paso', () => {
  const { r, checks, salida } = corre({ MODO: 'pendiente' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].metodo, 'POST');
  assert.equal(checks[0].cuerpo.name, 'revisor');
  assert.equal(checks[0].cuerpo.head_sha, SHA);
  assert.equal(checks[0].cuerpo.status, 'in_progress');
  assert.equal(checks[0].cuerpo.output.title, PENDING_TITLE);
  assert.equal(checks[0].cuerpo.conclusion, undefined, 'un check en curso no lleva conclusión');
  assert.equal(readFileSync(salida, 'utf8'), 'check_run=4242\n');
});

test('MODO=pendiente: el POST lleva external_id igual a RUN_ID, y sin RUN_ID falla en alto sin publicar', () => {
  const { r, checks } = corre({ MODO: 'pendiente', RUN_ID: '9001' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(checks[0].cuerpo.external_id, '9001');
  const sin = corre({ MODO: 'pendiente', RUN_ID: '' });
  assert.equal(sin.r.status, 1);
  assert.match(sin.r.stderr, /RUN_ID/);
  assert.deepEqual(sin.checks, []);
});

// MODO=cerrar: lo corre el trabajo cerrar de revisor.yml cuando juzgar no llegó al veredicto; cierra en failure el «juzgando» de ESE run.
const enCurso = (id, runId, extra = {}) => deLaApp(id, { status: 'in_progress', conclusion: null, external_id: runId, output: { title: PENDING_TITLE }, ...extra });
const cierra = (checks, extra = {}) => corre({ MODO: 'cerrar', RUN_ID: '777', CHECKS_FALSOS: JSON.stringify(checks), ...extra });

test('MODO=cerrar: hace UN solo PATCH, al juzgando de este run, en failure y con CUT_TITLE (lo que readCheckRuns cuenta como cut)', () => {
  const { r, checks } = cierra([enCurso(10, '777'), enCurso(11, '888'), deLaApp(12, { external_id: '777' })]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].metodo, 'PATCH');
  assert.equal(checks[0].ruta, '/repos/o/r/check-runs/10');
  assert.equal(checks[0].cuerpo.status, 'completed');
  assert.equal(checks[0].cuerpo.conclusion, 'failure');
  assert.equal(checks[0].cuerpo.output.title, CUT_TITLE);
  assert.match(checks[0].cuerpo.output.summary, /el juicio se cortó antes del veredicto \(run 777\)/);
  const leido = readCheckRuns([{ ...checks[0].cuerpo, id: 10 }]);
  assert.equal(leido.cut, 1, 'los lectores lo cuentan como cortado, no como unreadable');
  assert.deepEqual(leido.unreadable, []);
});

test('MODO=cerrar: sin ningún juzgando en curso de este run no publica nada, lo dice y sale con 0', () => {
  const { r, publicado } = cierra([enCurso(11, '888'), deLaApp(12, { external_id: '777' }), enCurso(13, '777', { app: { slug: 'otra' } })]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(publicado, []);
  assert.match(r.stdout, /nada que cerrar/);
});

test('MODO=cerrar: sin RUN_ID falla en alto y no publica; un error de la API sale con 1', () => {
  const sin = cierra([enCurso(10, '777')], { RUN_ID: '' });
  assert.equal(sin.r.status, 1);
  assert.match(sin.r.stderr, /RUN_ID/);
  assert.deepEqual(sin.publicado, []);
  const roto = cierra([], { CHECKS_FALSOS: '{"message":"x"}' });
  assert.equal(roto.r.status, 1, roto.r.stdout + roto.r.stderr);
  assert.deepEqual(roto.publicado, []);
});

test('MODO=pendiente: sin GITHUB_OUTPUT falla en alto y no publica nada', () => {
  const { r, checks } = corre({ MODO: 'pendiente', GITHUB_OUTPUT: '' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /GITHUB_OUTPUT/);
  assert.deepEqual(checks, []);
});

test('veredicto: un sí cierra con PATCH el check CHECK_RUN y no crea ningún check completado nuevo', () => {
  const { r, checks, publicado } = juzga();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].metodo, 'PATCH');
  assert.equal(checks[0].ruta, '/repos/o/r/check-runs/4242');
  assert.equal(checks[0].cuerpo.status, 'completed');
  assert.equal(checks[0].cuerpo.conclusion, 'success');
  assert.equal(extractRecord(checks[0].cuerpo.output.text).ok, true, 'el registro viaja en el PATCH');
  assert.equal(publicado.filter((p) => p.metodo === 'POST' && p.ruta.endsWith('/check-runs')).length, 0, 'ningún POST de check');
  assert.equal(publicado.find((p) => p.ruta.endsWith('/reviews'))?.cuerpo.event, 'APPROVE');
});

test('veredicto: un no también cierra el mismo check, en failure y sin aprobar', () => {
  const { r, checks, publicado } = juzga({ SALIDA: salidaNo });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(checks.map((c) => [c.metodo, c.cuerpo.conclusion]), [['PATCH', 'failure']]);
  assert.equal(publicado.find((p) => p.ruta.endsWith('/reviews')), undefined);
});

for (const [nombre, valor] of [['falta', undefined], ['vacío', ''], ['no es un número', 'abc'], ['es cero', '0']]) {
  test(`veredicto: CHECK_RUN ${nombre} publica un no «no se pudo marcar el juicio en curso», no aprueba y sale con 1`, () => {
    const { r, checks, publicado } = juzga({ CHECK_RUN: valor });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /CHECK_RUN/);
    assert.equal(checks.length, 1);
    assert.equal(checks[0].metodo, 'POST');
    assert.equal(checks[0].cuerpo.conclusion, 'failure');
    assert.match(checks[0].cuerpo.output.summary, /no se pudo marcar el juicio en curso/);
    assert.equal(publicado.find((p) => p.ruta.endsWith('/reviews')), undefined, 'no debe aprobar');
  });
}

test('veredicto: un sí con un `revisor` más nuevo de la App en la cabeza cierra su check en failure, sin aprobar', () => {
  const { r, checks, publicado } = juzga({ CHECKS_FALSOS: JSON.stringify([deLaApp(4242, { status: 'in_progress', conclusion: null }), deLaApp(5000, { status: 'in_progress', conclusion: null, output: { title: PENDING_TITLE } })]) });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(checks.map((c) => [c.metodo, c.cuerpo.conclusion]), [['PATCH', 'failure']]);
  assert.match(checks[0].cuerpo.output.summary, /hay un juicio más nuevo de esta cabeza/);
  assert.equal(extractRecord(checks[0].cuerpo.output.text).ok, false);
  assert.equal(publicado.find((p) => p.ruta.endsWith('/reviews')), undefined);
});

test('veredicto: un `revisor` más viejo, uno de otra App o un override no impiden el sí', () => {
  const otros = [deLaApp(100), deLaApp(6000, { app: { slug: 'otra' } }), deLaApp(7000, { output: { title: overrideTitle(OWNER_LOGIN), summary: 'x' } }), deLaApp(4242, { status: 'in_progress', conclusion: null })];
  const { r, checks } = juzga({ CHECKS_FALSOS: JSON.stringify(otros) });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(checks.map((c) => c.cuerpo.conclusion), ['success']);
});

test('veredicto: si el juez falla antes de cerrar el check (la API de reviews no da una lista), lo cierra en failure y sale con 1: nunca queda «juzgando» para siempre', () => {
  const { r, checks, publicado } = juzga({ REVIEWS_FALSAS: '{"message":"x"}' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(checks.map((c) => [c.metodo, c.ruta, c.cuerpo.conclusion]), [['PATCH', '/repos/o/r/check-runs/4242', 'failure']]);
  assert.match(checks[0].cuerpo.output.summary, /el juez falló antes de dar veredicto/);
  assert.equal(publicado.find((p) => p.ruta.endsWith('/reviews')), undefined);
});

test('veredicto: un fallo posterior a cerrar el check (el registro no se puede construir) no vuelve a tocar el check ya cerrado', () => {
  const { r, checks } = juzga({ GITHUB_RUN_ID: '555' });
  assert.equal(r.status, 1);
  assert.deepEqual(checks.map((c) => [c.metodo, c.cuerpo.conclusion]), [['PATCH', 'success']]);
});

test('anulación: con un juicio en curso encima de un no no anula; espera a que el juicio acabe (filter=all)', () => {
  const no = deLaApp(100, { conclusion: 'failure', output: { title: TITULO.no, summary: '- C5: no' } });
  const aprobacion = [{ id: 7, user: { login: OWNER_LOGIN }, state: 'APPROVED', commit_id: SHA }];
  const enCurso = deLaApp(200, { status: 'in_progress', conclusion: null, output: { title: PENDING_TITLE } });
  const con = (checks) => corre({ MODO: 'anulacion', REVISOR_APP_SLUG, REVIEWS_FALSAS: JSON.stringify(aprobacion), CHECKS_FALSOS: JSON.stringify(checks) });
  const esperando = con([no, enCurso]);
  assert.equal(esperando.r.status, 0, esperando.r.stderr);
  assert.deepEqual(esperando.checks, []);
  assert.match(esperando.r.stdout, /juicio en curso/);
  const sinCurso = con([no]);
  assert.equal(sinCurso.checks.length, 1, 'sin juicio en curso, el no se anula como siempre');
  assert.equal(sinCurso.checks[0].cuerpo.output.title, overrideTitle(OWNER_LOGIN));
});

// El workflow: el trabajo `pendiente` marca el juicio, `juzgar` espera por él y el token de ese trabajo no sale de él.
const wf = yaml.load(leer('.github/workflows/revisor.yml'));
const pasosDe = (job) => job.steps;
const usa = (paso, trozo) => JSON.stringify(paso).includes(trozo);

test('revisor.yml: el trabajo pendiente corre con el mismo if y el environment revisor, y publica con MODO=pendiente', () => {
  const { pendiente, juzgar } = wf.jobs;
  assert.ok(pendiente, 'falta el trabajo pendiente');
  assert.equal(pendiente.environment, 'revisor');
  assert.ok(juzgar.if.includes(pendiente.if), 'juzgar y pendiente deben tener la misma condición de partida');
  const paso = pasosDe(pendiente).find((p) => String(p.run ?? '').includes('veredicto.mjs'));
  assert.equal(paso?.env?.MODO, 'pendiente');
  assert.match(paso.run, /node \.fabrica\/scripts\/veredicto\.mjs/);
  assert.deepEqual(Object.keys(pendiente.outputs), ['check_run'], 'del trabajo pendiente solo sale el id del check');
  assert.ok(!pasosDe(pendiente).some((p) => String(p.uses ?? '').startsWith('anthropics/')), 'en el trabajo pendiente no corre Claude');
});

test('revisor.yml: juzgar espera a pendiente, corre aunque pendiente falle (no si se cancela) y cierra el check con CHECK_RUN', () => {
  const { juzgar } = wf.jobs;
  assert.deepEqual([juzgar.needs].flat(), ['pendiente']);
  assert.match(juzgar.if, /!cancelled\(\)/);
  const veredicto = pasosDe(juzgar).find((p) => String(p.run ?? '').includes('veredicto.mjs'));
  assert.equal(veredicto.env.CHECK_RUN, '${{ needs.pendiente.outputs.check_run }}');
});

test('revisor.yml: ningún paso de juzgar recibe el token que crea pendiente, y Claude no ve ni el id del check', () => {
  const { pendiente, juzgar } = wf.jobs;
  const tokenPendiente = pasosDe(pendiente).find((p) => String(p.uses ?? '').startsWith('actions/create-github-app-token'));
  assert.ok(tokenPendiente?.id, 'pendiente crea su propio token de la App');
  assert.ok(!/token/i.test(Object.keys(pendiente.outputs).join()), 'el token no es una salida del trabajo');
  for (const paso of pasosDe(juzgar)) {
    assert.ok(!usa(paso, `steps.${tokenPendiente.id}.`) && !usa(paso, 'needs.pendiente.outputs.token'), `un paso de juzgar recibe el token de pendiente: ${paso.id ?? paso.name ?? paso.uses}`);
  }
  const claude = pasosDe(juzgar).find((p) => String(p.uses ?? '').startsWith('anthropics/claude-code-action'));
  assert.ok(!usa(claude, 'needs.pendiente') && !usa(claude, 'CHECK_RUN'), 'el paso de Claude no recibe nada del trabajo pendiente');
});

test('revisor.yml: pendiente y juzgar piden solo los permisos que usan (pendiente no escribe más que checks)', () => {
  const { pendiente } = wf.jobs;
  assert.deepEqual(pendiente.permissions, { contents: 'read' });
  const token = pasosDe(pendiente).find((p) => String(p.uses ?? '').startsWith('actions/create-github-app-token'));
  assert.deepEqual(Object.keys(token.with).filter((k) => k.startsWith('permission-')), ['permission-checks']);
});

test('revisor.yml: cerrar corre tras pendiente y juzgar aunque se cancele el run, con la misma condición de repo y borrador, solo si juzgar no acabó en success', () => {
  const { pendiente, cerrar } = wf.jobs;
  assert.ok(cerrar, 'falta el trabajo cerrar');
  assert.deepEqual([cerrar.needs].flat().sort(), ['juzgar', 'pendiente']);
  assert.match(cerrar.if, /always\(\)/);
  assert.ok(cerrar.if.includes(pendiente.if), 'cerrar y pendiente deben tener la misma condición de repo y borrador');
  assert.match(cerrar.if, /needs\.juzgar\.result\s*!=\s*'success'/);
  assert.equal(cerrar.environment, 'revisor');
  assert.deepEqual(cerrar.permissions, { contents: 'read' });
  const paso = pasosDe(cerrar).find((p) => String(p.run ?? '').includes('veredicto.mjs'));
  assert.equal(paso?.env?.MODO, 'cerrar');
  assert.equal(paso.env.RUN_ID, '${{ github.run_id }}');
  assert.ok(!pasosDe(cerrar).some((p) => String(p.uses ?? '').startsWith('anthropics/')), 'en el trabajo cerrar no corre Claude');
});

test('revisor.yml: cerrar crea su propio token de la App (solo checks: write) y pendiente publica con RUN_ID', () => {
  const { pendiente, cerrar } = wf.jobs;
  const token = pasosDe(cerrar).find((p) => String(p.uses ?? '').startsWith('actions/create-github-app-token'));
  assert.ok(token?.id, 'cerrar crea su propio token de la App');
  assert.deepEqual(Object.keys(token.with).filter((k) => k.startsWith('permission-')), ['permission-checks']);
  const paso = pasosDe(cerrar).find((p) => String(p.run ?? '').includes('veredicto.mjs'));
  assert.equal(paso.env.TOKEN, '${{ steps.' + token.id + '.outputs.token }}');
  assert.equal(pasosDe(pendiente).find((p) => p.env?.MODO === 'pendiente').env.RUN_ID, '${{ github.run_id }}');
  for (const [nombre, job] of Object.entries(wf.jobs)) {
    if (nombre !== 'cerrar') for (const p of pasosDe(job)) assert.ok(!usa(p, `steps.${token.id}.`), `un paso de ${nombre} recibe el token de cerrar`);
  }
});

// El slug de la App de revisor (REVISOR_APP_SLUG): el juicio y `cerrar` filtran los check por la App del repo que llama, como la anulación.
const propia = 'otra-app-de-revisor';
const hom = (extra = {}) => ({ app: { slug: propia }, ...extra });

test('MODO=cerrar: con REVISOR_APP_SLUG de otra App cierra el juzgando de esa App y no el de la App de la Fábrica', () => {
  const checks = [enCurso(10, '777', hom()), enCurso(11, '777')];
  const suyo = cierra(checks, { REVISOR_APP_SLUG: propia });
  assert.equal(suyo.r.status, 0, suyo.r.stderr);
  assert.deepEqual(suyo.checks.map((c) => c.ruta), ['/repos/o/r/check-runs/10']);
  const fabrica = cierra(checks);
  assert.deepEqual(fabrica.checks.map((c) => c.ruta), ['/repos/o/r/check-runs/11'], 'sin pasar otro slug, vale el de la Fábrica');
});

test('veredicto: un sí con un `revisor` más nuevo de la App del llamador (REVISOR_APP_SLUG) se cierra en failure; el de la App de la Fábrica no cuenta', () => {
  const nuevo = (extra) => JSON.stringify([deLaApp(5000, { status: 'in_progress', conclusion: null, output: { title: PENDING_TITLE }, ...extra })]);
  const cuenta = juzga({ REVISOR_APP_SLUG: propia, CHECKS_FALSOS: nuevo(hom()) });
  assert.deepEqual(cuenta.checks.map((c) => c.cuerpo.conclusion), ['failure']);
  const ajeno = juzga({ REVISOR_APP_SLUG: propia, CHECKS_FALSOS: nuevo() });
  assert.deepEqual(ajeno.checks.map((c) => c.cuerpo.conclusion), ['success']);
});

test('veredicto y cerrar: sin REVISOR_APP_SLUG fallan en alto en un repo ajeno y en la propia Fábrica valen la constante', () => {
  for (const vacio of [undefined, '', '  ']) {
    const c = cierra([enCurso(10, '777')], { REVISOR_APP_SLUG: vacio });
    assert.equal(c.r.status, 1, JSON.stringify(vacio));
    assert.match(c.r.stderr, /REVISOR_APP_SLUG/);
    assert.deepEqual(c.checks, []);
    const j = juzga({ REVISOR_APP_SLUG: vacio });
    assert.equal(j.r.status, 1, JSON.stringify(vacio));
    assert.match(j.r.stderr, /REVISOR_APP_SLUG/);
    assert.ok(!j.checks.some((x) => x.cuerpo.conclusion === 'success'), 'nunca un sí sin saber qué App es la del llamador');
  }
  const enFabrica = cierra([enCurso(10, '777')], { REPO, REVISOR_APP_SLUG: '' });
  assert.equal(enFabrica.r.status, 0, enFabrica.r.stderr);
  assert.equal(enFabrica.checks.length, 1);
});

test('revisor.yml: workflow_call pide el slug de la App (opcional, por defecto el de la Fábrica) y juzgar y cerrar lo pasan como REVISOR_APP_SLUG; pendiente no filtra y no lo recibe', () => {
  const inputs = wf.on.workflow_call.inputs;
  assert.equal(inputs['revisor-app-slug'].required, false, 'homenu-panel llama @main sin esta entrada y no puede cambiarlo (ruleset sin bypass)');
  assert.equal(inputs['revisor-app-slug'].default, REVISOR_APP_SLUG, 'sin la entrada vale la App de la Fábrica, como antes de #182');
  const veredicto = (job) => pasosDe(job).find((p) => String(p.run ?? '').includes('veredicto.mjs'));
  for (const nombre of ['juzgar', 'cerrar']) {
    assert.equal(veredicto(wf.jobs[nombre]).env.REVISOR_APP_SLUG, '${{ inputs.revisor-app-slug }}', nombre);
  }
  assert.equal(veredicto(wf.jobs.pendiente).env.REVISOR_APP_SLUG, undefined);
});

test('la plantilla apps/proyecto-nuevo/revisor.yml pasa el slug de la App que crea la Fábrica', () => {
  const plantilla = yaml.load(leer('apps/proyecto-nuevo/revisor.yml'));
  assert.deepEqual(plantilla.jobs.revisor.with, { 'revisor-app-slug': REVISOR_APP_SLUG });
});
