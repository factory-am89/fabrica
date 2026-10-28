// The owner override: Pablo's approval of the current head turns a revisor "no" into a green check titled
// "override by Pablo". Rule in aprobacionDePablo (scripts/veredicto.mjs); workflows anulacion.yml and senal-review.yml.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { aprobacionDePablo } from '../scripts/veredicto.mjs';
import { OWNER_LOGIN, REVISOR_APP_SLUG, REPO } from '../scripts/lib/repo.mjs';
import { readCheckRuns } from '../scripts/lib/record.mjs';
import { buenas, SHA, leer, esCheck } from './apoyo/fabrica.mjs';

const VIEJA = 'b'.repeat(40);
const review = (extra = {}) => ({ id: 7, user: { login: OWNER_LOGIN }, state: 'APPROVED', commit_id: SHA, ...extra });

test('aprobacionDePablo: su aprobación sobre la cabeza actual anula; el login no distingue mayúsculas', () => {
  assert.equal(aprobacionDePablo([review()], SHA)?.id, 7);
  assert.equal(aprobacionDePablo([review({ user: { login: OWNER_LOGIN.toUpperCase() } })], SHA)?.id, 7);
});

test('aprobacionDePablo: cabeza vieja, otro autor, review descartada, sin commit_id, cambios pedidos después o sin reviews no anulan', () => {
  assert.equal(aprobacionDePablo([review({ commit_id: VIEJA })], SHA), null, 'cabeza vieja');
  assert.equal(aprobacionDePablo([review({ commit_id: undefined })], SHA), null, 'sin commit_id');
  assert.equal(aprobacionDePablo([review({ user: { login: 'otra-persona' } })], SHA), null, 'otro autor');
  assert.equal(aprobacionDePablo([review({ user: { login: 'fabrica-revisor[bot]' } })], SHA), null, 'la App no es Pablo');
  assert.equal(aprobacionDePablo([review(), review({ id: 8, state: 'DISMISSED' })], SHA), null, 'descartada');
  assert.equal(aprobacionDePablo([review(), review({ id: 8, state: 'CHANGES_REQUESTED' })], SHA), null, 'cambios pedidos después');
  assert.equal(aprobacionDePablo([review({ state: 'COMMENTED' })], SHA), null, 'un comentario no aprueba');
  assert.equal(aprobacionDePablo([], SHA), null);
  assert.equal(aprobacionDePablo([review()], undefined), null, 'sin cabeza');
  assert.equal(aprobacionDePablo([review({ commit_id: 'abc' })], 'abc'), null, 'una cabeza que no es un SHA completo');
});

test('aprobacionDePablo: un comentario posterior no borra su aprobación', () => {
  assert.equal(aprobacionDePablo([review(), review({ id: 8, state: 'COMMENTED' })], SHA)?.id, 7);
});

const corre = (extra) => {
  const precarga = pathToFileURL(fileURLToPath(new URL('./fixtures/github-falso.mjs', import.meta.url))).href;
  const ruta = fileURLToPath(new URL('../scripts/veredicto.mjs', import.meta.url));
  const r = spawnSync(process.execPath, ['--import', precarga, ruta], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, REPO: 'o/r', PR: '2', SHA, BASE: 'b'.repeat(40), TOKEN: 'falso', LECTOR: 'falso', CHECK_RUN: '4242', ...extra },
  });
  const publicado = r.stderr.split('\n').filter((l) => l.startsWith('PUBLICADO ')).map((l) => JSON.parse(l.slice(10)));
  return { r, checks: publicado.filter((p) => esCheck(p)).map((p) => p.cuerpo) };
};
const reviews = (...rs) => JSON.stringify(rs);
const SALIDA_NO = JSON.stringify({ respuestas: buenas().map((r, i) => (i === 0 ? { ...r, respuesta: 'no' } : r)) });
const juicio = (reviewsFalsas) => corre({ STANDARD: 'standards/code.md', SALIDA: SALIDA_NO, REVIEWS_FALSAS: reviewsFalsas });

test('juicio: un no con la aprobación de Pablo sobre la cabeza publica el no y, después, el verde «override by Pablo» con los hallazgos', () => {
  const { r, checks } = juicio(reviews(review()));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(checks.map((c) => c.conclusion), ['failure', 'success'], 'el último check es el verde');
  assert.equal(checks[1].output.title, 'override by Pablo');
  assert.match(checks[1].output.summary, new RegExp(`${OWNER_LOGIN}.*review 7.*${SHA}`));
  assert.ok(checks[1].output.summary.includes(`- ${buenas()[0].id}: no`), checks[1].output.summary);
  assert.equal(checks[1].head_sha, SHA);
});

for (const [nombre, rs] of [
  ['sobre una cabeza vieja', reviews(review({ commit_id: VIEJA }))],
  ['de otro usuario', reviews(review({ user: { login: 'otra-persona' } }))],
  ['descartada', reviews(review(), review({ id: 8, state: 'DISMISSED' }))],
  ['sin aprobación', reviews()],
]) {
  test(`juicio: un no con una review ${nombre} sigue en rojo, sin override`, () => {
    const { r, checks } = juicio(rs);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(checks.map((c) => c.conclusion), ['failure']);
  });
}

test('juicio: un sí no publica ningún override aunque Pablo haya aprobado', () => {
  const { checks } = corre({ STANDARD: 'standards/code.md', SALIDA: JSON.stringify({ respuestas: buenas() }), REVIEWS_FALSAS: reviews(review()) });
  assert.deepEqual(checks.map((c) => c.output.title), ['Veredicto: sí']);
});

const previo = (extra = {}) => ({ id: 100, status: 'completed', conclusion: 'failure', app: { slug: 'fabrica-revisor' }, output: { title: 'Veredicto: no', summary: '- C5: no\n- C9: sin prueba' }, ...extra });
const anula = (reviewsFalsas, checksFalsos) => corre({ MODO: 'anulacion', REVIEWS_FALSAS: reviewsFalsas, CHECKS_FALSOS: JSON.stringify(checksFalsos) });

const anulaCon = (reviewsFalsas, checksFalsos, slug) =>
  corre({ MODO: 'anulacion', REVIEWS_FALSAS: reviewsFalsas, CHECKS_FALSOS: JSON.stringify(checksFalsos), ...(slug === undefined ? {} : { REVISOR_APP_SLUG: slug }) });

test('anulación (tras una review): su aprobación sobre la cabeza convierte el último rojo de la App en verde, con los hallazgos', () => {
  const { r, checks } = anula(reviews(review()), [previo()]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].conclusion, 'success');
  assert.equal(checks[0].output.title, 'override by Pablo');
  assert.match(checks[0].output.summary, /- C5: no\n- C9: sin prueba/);
  assert.match(r.stdout, /override by Pablo/);
});

for (const [nombre, rs] of [
  ['una cabeza vieja', reviews(review({ commit_id: VIEJA }))],
  ['otro usuario', reviews(review({ user: { login: 'otra-persona' } }))],
  ['ninguna aprobación', reviews()],
]) {
  test(`anulación: con ${nombre} no publica nada`, () => {
    const { r, checks } = anula(rs, [previo()]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(checks, []);
  });
}

test('anulación: no pisa un verde, ni un check que no es de la App, ni la falta de veredicto', () => {
  for (const checksFalsos of [[previo({ conclusion: 'success' })], [previo({ app: { slug: 'otra' } })], [previo({ status: 'in_progress' })], []]) {
    assert.deepEqual(anula(reviews(review()), checksFalsos).checks, [], JSON.stringify(checksFalsos));
  }
});

test('anulación: lo que cuenta es el último check de la App, no uno viejo en verde', () => {
  const { checks } = anula(reviews(review()), [previo({ id: 90, conclusion: 'success' }), previo({ id: 100 })]);
  assert.equal(checks.length, 1);
});

test('anulación: con la App propia de otro repo (REVISOR_APP_SLUG) anula su rojo y no el de la App de la Fábrica', () => {
  const propia = previo({ app: { slug: 'homenu-revisor' } });
  assert.equal(anulaCon(reviews(review()), [propia], 'homenu-revisor').checks.length, 1);
  assert.deepEqual(anulaCon(reviews(review()), [propia]).checks, [], 'sin el slug, la App ajena no cuenta');
  assert.deepEqual(anulaCon(reviews(review()), [previo()], 'homenu-revisor').checks, [], 'con el slug de HoMenu, la App de la Fábrica no cuenta');
  const vacio = anulaCon(reviews(review()), [propia], '  ');
  assert.equal(vacio.r.status, 1);
  assert.match(vacio.r.stderr, /REVISOR_APP_SLUG/);
});

test('anulación: sin TOKEN falla en alto', () => {
  const { r } = corre({ MODO: 'anulacion', TOKEN: '' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /TOKEN/);
});

const cargar = (f) => ({ texto: leer(`.github/workflows/${f}`), doc: yaml.load(leer(`.github/workflows/${f}`)) });

test('anulacion.yml: workflow_run o workflow_call, sin bajar nunca el código del PR y con el juez de la Fábrica', () => {
  const { texto, doc } = cargar('anulacion.yml');
  const on = doc.on ?? doc[true];
  assert.deepEqual(Object.keys(on).sort(), ['workflow_call', 'workflow_run'], 'cualquier otro evento ejecutaría el workflow tal como lo trae el PR');
  assert.deepEqual(on.workflow_run.workflows, ['senal-review']);
  assert.deepEqual(Object.keys(on.workflow_call).sort(), ['inputs', 'secrets'], 'el único input es el slug de su App: nada del llamador decide qué se baja');
  assert.deepEqual(Object.keys(on.workflow_call.inputs), ['revisor-app-slug']);
  assert.equal(on.workflow_call.inputs['revisor-app-slug'].default, REVISOR_APP_SLUG);
  assert.deepEqual(Object.keys(on.workflow_call.secrets).sort(), ['REVISOR_APP_KEY', 'REVISOR_CLIENT_ID'], 'el check lo publica la App del repo que llama');
  assert.doesNotMatch(texto, /head_sha|head_branch|pull_request\.head/, 'nada del PR decide qué código se baja');
  const pasos = Object.values(doc.jobs).flatMap((j) => j.steps);
  const checkouts = pasos.filter((p) => String(p.uses ?? '').startsWith('actions/checkout'));
  assert.equal(checkouts.length, 1);
  assert.equal(checkouts[0].with.repository, REPO);
  assert.equal(checkouts[0].with.ref, '${{ job.workflow_sha }}', 'el juez, en el commit de este workflow');
  assert.equal(checkouts[0].with.path, '.fabrica');
  assert.equal(Object.values(doc.jobs)[0].environment, 'revisor');
  const app = pasos.find((p) => String(p.uses ?? '').startsWith('actions/create-github-app-token'));
  assert.equal(app.with['client-id'], '${{ secrets.REVISOR_CLIENT_ID }}');
  assert.equal(app.with['private-key'], '${{ secrets.REVISOR_APP_KEY }}');
  const juez = pasos.find((p) => String(p.run ?? '').includes('veredicto.mjs'));
  assert.equal(juez.run, 'node .fabrica/scripts/veredicto.mjs');
  assert.equal(juez.env.MODO, 'anulacion');
  assert.match(juez.env.REVISOR_APP_SLUG, /inputs\.revisor-app-slug/, 'veredicto.mjs cuenta los check de la App del llamador');
});

test('senal-review.yml: solo despierta; sin secretos, sin permisos, sin checkout, sin código del PR', () => {
  const { texto, doc } = cargar('senal-review.yml');
  assert.deepEqual(doc.permissions, {});
  assert.doesNotMatch(texto, /secrets|environment|checkout|uses:/);
  assert.deepEqual(Object.keys(doc.on ?? doc[true]).sort(), ['pull_request_review', 'workflow_call']);
  assert.equal((doc.on ?? doc[true]).workflow_call, null, 'workflow_call sin secretos ni inputs');
});

test('records: un check «override by Pablo» se cuenta aparte y no es un registro ilegible', () => {
  const r = readCheckRuns([{ output: { title: 'override by Pablo', summary: 'x' } }]);
  assert.equal(r.overrides, 1);
  assert.deepEqual(r.unreadable, []);
  assert.equal(readCheckRuns([{ output: { title: 'otro' } }]).unreadable.length, 1);
});

test('aprobacionDePablo: una lista de reviews que no es una lista lanza, no cuenta como «sin reviews»', () => {
  for (const mala of [undefined, null, {}, 'x']) assert.throws(() => aprobacionDePablo(mala, SHA), /lista/, String(mala));
});

test('anulación: un check rojo sin resumen falla en alto y no publica nada', () => {
  for (const output of [{ title: 'Veredicto: no' }, { title: 'Veredicto: no', summary: '  ' }, undefined]) {
    const { r, checks } = anula(reviews(review()), [previo({ output })]);
    assert.equal(r.status, 1, JSON.stringify(output));
    assert.match(r.stderr, /resumen/);
    assert.deepEqual(checks, []);
  }
});

test('anulación: una página de reviews que no es una lista falla en alto', () => {
  const { r, checks } = anula('{"message":"x"}', [previo()]);
  assert.equal(r.status, 1);
  assert.deepEqual(checks, []);
});

test('REVISOR_APP_SLUG es la App que crean apps/crear-apps.html y apps/convertir.mjs', () => {
  assert.ok(leer('apps/crear-apps.html').includes(`<h2>2. ${REVISOR_APP_SLUG}</h2>`), 'crear-apps.html no crea la App con ese nombre');
  assert.ok(leer('apps/convertir.mjs').includes(`startsWith('${REVISOR_APP_SLUG}')`), 'convertir.mjs no reconoce ese nombre');
  assert.doesNotMatch(leer('scripts/veredicto.mjs'), /['"]fabrica-revisor['"]/, 'el slug va en la constante, no escrito a mano');
});
