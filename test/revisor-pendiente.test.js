// lesson: required-check-stale-while-rejudged
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
import { PENDING_TITLE, OVERRIDE_TITLE, extractRecord } from '../scripts/lib/record.mjs';
import { OWNER_LOGIN, REVISOR_APP_SLUG } from '../scripts/lib/repo.mjs';
import { buenas, SHA, leer } from './apoyo/fabrica.mjs';

const corre = (extra) => {
  const ruta = process.env.VEREDICTO_RUTA ?? fileURLToPath(new URL('../scripts/veredicto.mjs', import.meta.url));
  const precarga = pathToFileURL(fileURLToPath(new URL('./fixtures/github-falso.mjs', import.meta.url))).href;
  const salida = path.join(mkdtempSync(path.join(tmpdir(), 'pendiente-')), 'github-output');
  const r = spawnSync(process.execPath, ['--import', precarga, ruta], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, REPO: 'o/r', PR: '2', SHA, BASE: 'b'.repeat(40), TOKEN: 'falso', LECTOR: 'falso', GITHUB_OUTPUT: salida, ...extra },
  });
  const publicado = r.stderr.split('\n').filter((l) => l.startsWith('PUBLICADO ')).map((l) => JSON.parse(l.slice(10)));
  const checks = publicado.filter((p) => /\/check-runs(\/\d+)?$/.test(p.ruta));
  return { r, publicado, checks, salida };
};
const juzga = (extra = {}) => corre({ STANDARD: 'standards/code.md', SALIDA: JSON.stringify({ respuestas: buenas() }), CHECK_RUN: '4242', ...extra });
const deLaApp = (id, extra = {}) => ({ id, status: 'completed', conclusion: 'success', app: { slug: REVISOR_APP_SLUG }, output: { title: 'Veredicto: sí', summary: 'x' }, ...extra });
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
  const otros = [deLaApp(100), deLaApp(6000, { app: { slug: 'otra' } }), deLaApp(7000, { output: { title: OVERRIDE_TITLE, summary: 'x' } }), deLaApp(4242, { status: 'in_progress', conclusion: null })];
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
  const no = deLaApp(100, { conclusion: 'failure', output: { title: 'Veredicto: no', summary: '- C5: no' } });
  const aprobacion = [{ id: 7, user: { login: OWNER_LOGIN }, state: 'APPROVED', commit_id: SHA }];
  const enCurso = deLaApp(200, { status: 'in_progress', conclusion: null, output: { title: PENDING_TITLE } });
  const con = (checks) => corre({ MODO: 'anulacion', REVIEWS_FALSAS: JSON.stringify(aprobacion), CHECKS_FALSOS: JSON.stringify(checks) });
  const esperando = con([no, enCurso]);
  assert.equal(esperando.r.status, 0, esperando.r.stderr);
  assert.deepEqual(esperando.checks, []);
  assert.match(esperando.r.stdout, /juicio en curso/);
  const sinCurso = con([no]);
  assert.equal(sinCurso.checks.length, 1, 'sin juicio en curso, el no se anula como siempre');
  assert.equal(sinCurso.checks[0].cuerpo.output.title, OVERRIDE_TITLE);
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
