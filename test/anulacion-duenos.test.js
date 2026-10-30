// Anulación con varios dueños por repo y nunca sobre el trabajo propio (decisión B1 del 2026-10-29, plans/puente-2-alvaro.md, trozo 6).
// Un repo que llama a anulacion.yml con la entrada `duenos` («login:app,app» por dueño) deja anular a cada dueño, salvo un PR que
// abrió una de sus propias Apps (cuatro ojos). Sin la entrada (la propia Fábrica) solo anula OWNER_LOGIN, como siempre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { aprobacionDeDueno, leerDuenos } from '../scripts/veredicto.mjs';
import { OWNER_LOGIN, REVISOR_APP_SLUG, REPO } from '../scripts/lib/repo.mjs';
import { OVERRIDE_PREFIX, overrideTitle, readCheckRuns } from '../scripts/lib/record.mjs';
import { buenas, SHA, leer, esCheck } from './apoyo/fabrica.mjs';

const ALVARO = 'algbarc-design';
const DUENOS = `${OWNER_LOGIN}:fabrica-constructor,homenu-sesiones,${ALVARO}:alvaro-sesiones`;
const duenos = leerDuenos(DUENOS);
const review = (login, extra = {}) => ({ id: 7, user: { login }, state: 'APPROVED', commit_id: SHA, ...extra });

test('leerDuenos: piezas con comas, «login:app» abre un dueño y «app» suelta se suma al de antes; vacío o sin la variable es null (la Fábrica)', () => {
  assert.deepEqual(duenos, [
    { login: OWNER_LOGIN, apps: ['fabrica-constructor', 'homenu-sesiones'] },
    { login: ALVARO, apps: ['alvaro-sesiones'] },
  ]);
  assert.deepEqual(leerDuenos(`${OWNER_LOGIN}:a, ${ALVARO}:b`).map((d) => d.login), [OWNER_LOGIN, ALVARO], 'espacios junto a las comas');
  assert.deepEqual(leerDuenos(`${OWNER_LOGIN}:fabrica-constructor,${ALVARO}:alvaro-sesiones`), [
    { login: OWNER_LOGIN, apps: ['fabrica-constructor'] },
    { login: ALVARO, apps: ['alvaro-sesiones'] },
  ], 'el ejemplo del plan, tal cual');
  for (const vacio of [undefined, '', '  \n ']) assert.equal(leerDuenos(vacio), null, JSON.stringify(vacio));
});

test('leerDuenos: una entrada mal formada o un dueño repetido fallan en alto, nunca se ignoran', () => {
  for (const malo of ['pabloam89', 'app,pabloam89:a', 'pabloam89:', ':app', 'pabloam89:a:b', 'pabloam89:a,,b', 'pablo am89:a', 'pab/lo:a', 'pabloam89:a,PabloAM89:b']) {
    assert.throws(() => leerDuenos(malo), /DUENOS/, malo);
  }
});

test('aprobacionDeDueno: cualquiera de los dueños anula un PR que no abrió una App suya', () => {
  assert.equal(aprobacionDeDueno([review(ALVARO)], SHA, duenos, 'fabrica-constructor[bot]')?.user.login, ALVARO, 'Álvaro anula un PR de las sesiones de Pablo');
  assert.equal(aprobacionDeDueno([review(OWNER_LOGIN)], SHA, duenos, 'alvaro-sesiones[bot]')?.user.login, OWNER_LOGIN, 'Pablo anula un PR de las sesiones de Álvaro');
  assert.equal(aprobacionDeDueno([review(OWNER_LOGIN)], SHA, duenos, 'homenu-dependabot-merge[bot]')?.user.login, OWNER_LOGIN, 'una App de nadie: anula cualquiera');
});

test('aprobacionDeDueno: nunca sobre el trabajo propio (cuatro ojos), sin distinguir mayúsculas', () => {
  assert.equal(aprobacionDeDueno([review(OWNER_LOGIN)], SHA, duenos, 'fabrica-constructor[bot]'), null);
  assert.equal(aprobacionDeDueno([review(OWNER_LOGIN)], SHA, duenos, 'HoMenu-Sesiones[bot]'), null);
  assert.equal(aprobacionDeDueno([review(ALVARO.toUpperCase())], SHA, duenos, 'alvaro-sesiones[bot]'), null);
  assert.equal(aprobacionDeDueno([review(ALVARO)], SHA, duenos, ALVARO), null, 'su propio PR a mano tampoco');
  const ambos = [review(OWNER_LOGIN), review(ALVARO, { id: 8 })];
  assert.equal(aprobacionDeDueno(ambos, SHA, duenos, 'fabrica-constructor[bot]')?.id, 8, 'la del otro dueño sí cuenta');
});

test('aprobacionDeDueno: las tres condiciones de siempre siguen (cabeza actual, última decisiva, autor de la lista)', () => {
  const autor = 'fabrica-constructor[bot]';
  assert.equal(aprobacionDeDueno([review(ALVARO, { commit_id: 'b'.repeat(40) })], SHA, duenos, autor), null, 'cabeza vieja');
  assert.equal(aprobacionDeDueno([review(ALVARO), review(ALVARO, { id: 8, state: 'DISMISSED' })], SHA, duenos, autor), null, 'descartada');
  assert.equal(aprobacionDeDueno([review('otra-persona')], SHA, duenos, autor), null, 'no es dueño');
  assert.equal(aprobacionDeDueno([review(ALVARO), review(OWNER_LOGIN, { id: 8 })], SHA, duenos, 'otra[bot]')?.id, 8, 'con dos, la más reciente');
});

test('aprobacionDeDueno: sin autor del PR o sin dueños falla en alto', () => {
  for (const autor of [undefined, null, '']) assert.throws(() => aprobacionDeDueno([review(ALVARO)], SHA, duenos, autor), /autor/, String(autor));
  assert.throws(() => aprobacionDeDueno([review(ALVARO)], SHA, [], 'x[bot]'), /dueños/);
});

const corre = (extra) => {
  const precarga = pathToFileURL(fileURLToPath(new URL('./fixtures/github-falso.mjs', import.meta.url))).href;
  const ruta = fileURLToPath(new URL('../scripts/veredicto.mjs', import.meta.url));
  const r = spawnSync(process.execPath, ['--import', precarga, ruta], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, REPO: 'o/r', REVISOR_APP_SLUG, PR: '2', SHA, BASE: 'b'.repeat(40), TOKEN: 'falso', LECTOR: 'falso', CHECK_RUN: '4242', ...extra },
  });
  const publicado = r.stderr.split('\n').filter((l) => l.startsWith('PUBLICADO ')).map((l) => JSON.parse(l.slice(10)));
  return { r, checks: publicado.filter((p) => esCheck(p)).map((p) => p.cuerpo) };
};
const previo = { id: 100, status: 'completed', conclusion: 'failure', app: { slug: REVISOR_APP_SLUG }, output: { title: 'Veredicto: no', summary: '- C5: no' } };
const anula = (reviews, autor, extra = {}) =>
  corre({ MODO: 'anulacion', DUENOS, AUTOR_FALSO: autor, REVIEWS_FALSAS: JSON.stringify(reviews), CHECKS_FALSOS: JSON.stringify([previo]), ...extra });

test('anulación con DUENOS: Álvaro anula un PR de las sesiones de Pablo y el título nombra a quien anula', () => {
  const { r, checks } = anula([review(ALVARO)], 'fabrica-constructor[bot]');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].conclusion, 'success');
  assert.equal(checks[0].output.title, `override by ${ALVARO}`);
  assert.equal(readCheckRuns([{ output: checks[0].output }]).overrides, 1, 'records lo sigue contando como override');
});

test('anulación con DUENOS: Pablo no anula un PR de sus propias sesiones y no se publica nada', () => {
  const { r, checks } = anula([review(OWNER_LOGIN)], 'homenu-sesiones[bot]');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(checks, []);
  assert.match(r.stdout, /no hay aprobación de un dueño/);
});

test('anulación con DUENOS: un DUENOS mal formado o un PR sin autor fallan en alto antes de publicar nada', () => {
  const mal = anula([review(ALVARO)], 'fabrica-constructor[bot]', { DUENOS: 'pabloam89' });
  assert.equal(mal.r.status, 1);
  assert.match(mal.r.stderr, /DUENOS/);
  assert.deepEqual(mal.checks, []);
  const sinAutor = anula([review(ALVARO)], '');
  assert.equal(sinAutor.r.status, 1);
  assert.match(sinAutor.r.stderr, /autor/);
  assert.deepEqual(sinAutor.checks, []);
});

test('anulación sin DUENOS (la Fábrica): solo OWNER_LOGIN, también sobre un PR de su App, como siempre', () => {
  const pablo = corre({ MODO: 'anulacion', REPO, REVIEWS_FALSAS: JSON.stringify([review(OWNER_LOGIN)]), CHECKS_FALSOS: JSON.stringify([previo]) });
  assert.equal(pablo.r.status, 0, pablo.r.stderr);
  assert.equal(pablo.checks[0].output.title, overrideTitle(OWNER_LOGIN));
  const alvaro = corre({ MODO: 'anulacion', REPO, REVIEWS_FALSAS: JSON.stringify([review(ALVARO)]), CHECKS_FALSOS: JSON.stringify([previo]) });
  assert.deepEqual(alvaro.checks, [], 'en la Fábrica Álvaro no anula');
});

const SALIDA_NO = JSON.stringify({ respuestas: buenas().map((r, i) => (i === 0 ? { ...r, respuesta: 'no' } : r)) });
test('juicio en un repo ajeno: no aplica una aprobación temprana (no conoce DUENOS); la anulación la decide anulacion.yml', () => {
  const { r, checks } = corre({ STANDARD: 'standards/code.md', SALIDA: SALIDA_NO, REVIEWS_FALSAS: JSON.stringify([review(OWNER_LOGIN)]) });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(checks.map((c) => c.conclusion), ['failure'], 'solo el no, sin override');
});

test('records: el título nuevo y el viejo («override by Pablo») cuentan los dos como override', () => {
  assert.ok(overrideTitle(ALVARO).startsWith(OVERRIDE_PREFIX));
  const r = readCheckRuns([{ output: { title: 'override by Pablo' } }, { output: { title: overrideTitle(ALVARO) } }]);
  assert.equal(r.overrides, 2);
  assert.deepEqual(r.unreadable, []);
});

test('anulacion.yml: la entrada `duenos` es opcional y llega a veredicto.mjs como DUENOS', () => {
  const doc = yaml.load(leer('.github/workflows/anulacion.yml'));
  const entrada = (doc.on ?? doc[true]).workflow_call.inputs.duenos;
  assert.ok(entrada, 'falta la entrada duenos');
  assert.equal(entrada.type, 'string');
  assert.equal(entrada.required, false, 'sin ella (la Fábrica) todo sigue igual');
  const juez = Object.values(doc.jobs).flatMap((j) => j.steps).find((p) => String(p.run ?? '').includes('veredicto.mjs'));
  assert.equal(juez.env.DUENOS, '${{ inputs.duenos }}');
});
