// Lo que la Fábrica se exige a sí misma, comprobado por máquina (principio 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { decidir, leerPreguntas, tocaArbitro, aprobadoPorPablo } from '../scripts/veredicto.mjs';
import { destino, argsSecreto } from '../apps/convertir.mjs';
import { jwt, orden } from '../scripts/token.mjs';

const leer = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');
const preguntas = leerPreguntas(leer('estandares/codigo.md'));

test('CLAUDE.md es corto y tiene los 6 principios por su palabra clave', () => {
  const texto = leer('CLAUDE.md');
  const lineas = texto.split('\n').filter((l) => l.trim());
  assert.ok(lineas.length <= 20, `tiene ${lineas.length} líneas con texto`);
  const claves = ['Verdad', 'Evidencia', 'Fallar en alto', 'Una idea, un sitio', 'Lo que comprueba una máquina', 'Parar y apuntar'];
  claves.forEach((clave, i) => {
    assert.match(texto, new RegExp(`^${i + 1}\\. ${clave}`, 'm'), `falta el principio ${i + 1}: ${clave}`);
  });
});

test('los tres roles tienen su modelo y el revisor no escribe', () => {
  const modelos = { arquitecto: 'opus', constructor: 'sonnet', revisor: 'opus' };
  for (const [rol, modelo] of Object.entries(modelos)) {
    const cabecera = leer(`.claude/agents/${rol}.md`).split('---')[1];
    assert.match(cabecera, new RegExp(`^name: ${rol}$`, 'm'));
    assert.match(cabecera, new RegExp(`^model: ${modelo}$`, 'm'));
    if (rol !== 'constructor') assert.doesNotMatch(cabecera, /Edit|Write/);
  }
});

test('el estándar tiene de 10 a 12 preguntas, cada una con bien y mal', () => {
  assert.ok(preguntas.length >= 10 && preguntas.length <= 12, `hay ${preguntas.length}`);
  const bloques = leer('estandares/codigo.md').split(/^### /m).slice(1);
  for (const b of bloques) {
    assert.match(b, /^Bien: /m, b.split('\n')[0]);
    assert.match(b, /^Mal: /m, b.split('\n')[0]);
  }
});

const workflows = readdirSync(new URL('../.github/workflows/', import.meta.url));

test('los workflows declaran permisos y fijan cada acción por SHA (C4)', () => {
  assert.ok(workflows.length > 0);
  for (const f of workflows) {
    const texto = leer(`.github/workflows/${f}`);
    assert.match(texto, /^permissions:/m, `${f} sin permissions`);
    assert.doesNotMatch(texto, /permissions:\s*write-all/, `${f} con write-all`);
    for (const [, accion] of texto.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
      assert.match(accion, /@[0-9a-f]{40}$/, `${f}: ${accion} sin SHA`);
    }
  }
});

test('revisor.yml usa pull_request_target, no baja el código del PR y guarda los secretos en el environment revisor', () => {
  const texto = leer('.github/workflows/revisor.yml');
  assert.match(texto, /^on:\s*\n(\s*#.*\n)*\s+pull_request_target:/m);
  assert.doesNotMatch(texto, /^\s*ref:/m, 'un checkout con ref: traería el código del PR');
  assert.match(texto, /^ {4}environment: revisor$/m, 'sin environment revisor los secretos serían del repo');
});

test('revisor.yml juzga el diff del SHA exacto y Claude no tiene gh pr diff', () => {
  const texto = leer('.github/workflows/revisor.yml');
  assert.match(texto, /compare\/\$BASE\.\.\.\$SHA/);
  assert.match(texto, /Accept: application\/vnd\.github\.diff/);
  assert.doesNotMatch(texto, /Bash\(gh pr diff/);
  assert.match(texto, /client-id:/);
  assert.doesNotMatch(texto, /app-id:/);
});

test('convertir.mjs guarda los secretos del revisor en su environment', () => {
  assert.deepEqual(argsSecreto('REVISOR_APP_KEY').slice(-2), ['--env', 'revisor']);
  assert.doesNotMatch(leer('apps/convertir.mjs'), /REVISOR_APP_ID/);
});

test('PASOS-PABLO: el environment se crea antes de guardar secretos y el ruleset no restringe updates', () => {
  const pasos = leer('PASOS-PABLO.md');
  assert.ok(pasos.indexOf('environments/revisor') < pasos.indexOf('node apps/convertir.mjs'));
  assert.match(pasos, /\*\*No\*\* actives «Restrict updates»/);
  assert.match(pasos, /Block force pushes/);
  assert.match(pasos, /Ningún constructor trabaja antes de que exista el ruleset/);
});

function manifests() {
  const html = leer('apps/crear-apps.html');
  const valores = [...html.matchAll(/name="manifest" value="([^"]*)"/g)].map((m) => m[1]);
  return valores.map((v) => JSON.parse(v.replaceAll('&quot;', '"').replaceAll('&amp;', '&')));
}

test('las dos Apps piden solo los permisos acordados', () => {
  const [constructor, revisor] = manifests();
  assert.deepEqual(constructor.default_permissions, {
    contents: 'write', pull_requests: 'write', issues: 'write', workflows: 'write', checks: 'read', actions: 'read',
  });
  assert.deepEqual(revisor.default_permissions, { pull_requests: 'write', checks: 'write' });
  for (const m of [constructor, revisor]) {
    for (const prohibido of ['administration', 'secrets', 'environments']) {
      assert.ok(!(prohibido in m.default_permissions), `${m.name} pide ${prohibido}`);
    }
  }
});

test('convertir.mjs solo reconoce las dos Apps', () => {
  assert.equal(destino('fabrica-constructor'), 'constructor');
  assert.equal(destino('fabrica-revisor-1'), 'revisor');
  assert.throws(() => destino('otra'));
});

const buenas = () => preguntas.filter((p) => p.quien === 'revisor').map((p) => ({ id: p.id, respuesta: 'sí', prueba: 'x.js:1' }));
const SHA = 'a'.repeat(40);
const ctx = (extra = {}) => ({ sha: SHA, cabeza: SHA, ficheros: ['src/x.js'], pablo: false, ...extra });
const juzga = (respuestas, c = ctx()) => decidir(JSON.stringify({ respuestas }), preguntas, c);

test('veredicto: sí solo si todo lo del revisor es sí o no aplica con prueba', () => {
  assert.equal(juzga(buenas()).ok, true);
});

test('veredicto: un no, un hueco, una respuesta sin prueba o una salida rota son no', () => {
  const r = buenas();
  assert.equal(juzga([{ ...r[0], respuesta: 'no' }, ...r.slice(1)]).ok, false);
  assert.equal(juzga(r.slice(1)).ok, false);
  assert.equal(juzga([{ ...r[0], prueba: ' ' }, ...r.slice(1)]).ok, false);
  assert.equal(juzga([{ ...r[0], respuesta: 'tal vez' }, ...r.slice(1)]).ok, false);
  assert.equal(decidir('', preguntas, ctx()).ok, false);
  assert.equal(decidir('{no json', preguntas, ctx()).ok, false);
});

test('veredicto: ids duplicados son no, aunque uno diga sí', () => {
  const r = buenas();
  assert.equal(juzga([...r, { ...r[0], respuesta: 'no' }]).ok, false);
  assert.equal(juzga([...r, { ...r[0] }]).ok, false);
});

test('veredicto: si la cabeza del PR ya no es el SHA juzgado, es no', () => {
  assert.equal(juzga(buenas(), ctx({ cabeza: 'b'.repeat(40) })).ok, false);
  assert.equal(decidir(JSON.stringify({ respuestas: buenas() }), preguntas, {}).ok, false);
});

test('veredicto: un diff que toca el árbitro es no salvo que Pablo lo haya aprobado', () => {
  for (const f of ['.github/workflows/revisor.yml', 'scripts/veredicto.mjs', 'estandares/codigo.md', '.claude/agents/revisor.md']) {
    assert.equal(tocaArbitro([f]), true, f);
    const sinPablo = juzga(buenas(), ctx({ ficheros: ['src/x.js', f] }));
    assert.equal(sinPablo.ok, false, f);
    assert.match(sinPablo.fallos.join(), /requiere aprobación de Pablo/);
    assert.equal(juzga(buenas(), ctx({ ficheros: [f], pablo: true })).ok, true, f);
  }
  assert.equal(tocaArbitro(['src/x.js', 'scripts/token.mjs', 'test/fabrica.test.js']), false);
});

test('aprobación de Pablo: la última review suya, aprobada y sobre el SHA actual', () => {
  const rev = (state, commit, login = 'pabloam89') => ({ user: { login }, state, commit_id: commit });
  assert.equal(aprobadoPorPablo([rev('APPROVED', SHA)], SHA), true);
  assert.equal(aprobadoPorPablo([rev('APPROVED', 'b'.repeat(40))], SHA), false);
  assert.equal(aprobadoPorPablo([rev('APPROVED', SHA), rev('CHANGES_REQUESTED', SHA)], SHA), false);
  assert.equal(aprobadoPorPablo([rev('APPROVED', SHA, 'fabrica-revisor[bot]')], SHA), false);
});

test('token.mjs: JWT RS256 con el client id, orden tras -- y sin escribir en disco', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const [cab, cuerpo, firma] = jwt('Iv1.abc', pem, 1000).split('.');
  assert.equal(JSON.parse(Buffer.from(cab, 'base64url')).alg, 'RS256');
  const dec = JSON.parse(Buffer.from(cuerpo, 'base64url'));
  assert.deepEqual([dec.iss, dec.iat, dec.exp], ['Iv1.abc', 940, 1540]);
  assert.ok(createVerify('RSA-SHA256').update(`${cab}.${cuerpo}`).verify(publicKey, firma, 'base64url'));
  assert.deepEqual(orden(['--', 'gh', 'pr', 'list']), ['gh', 'pr', 'list']);
  assert.throws(() => orden(['gh']));
  assert.doesNotMatch(leer('scripts/token.mjs'), /writeFile|appendFile|console\.log\(.*token/);
});

test('CLAUDE.md y PASOS-PABLO.md no llevan caracteres de control', () => {
  for (const f of ['CLAUDE.md', 'PASOS-PABLO.md']) assert.doesNotMatch(leer(f), /[\x00-\x08\x0b\x0c\x0e-\x1f]/, f); // eslint-disable-line no-control-regex
});

test('veredicto: los CLAUDE.md (raíz o anidados) son configuración del árbitro', () => {
  for (const f of ['CLAUDE.md', 'apps/x/CLAUDE.md', 'a/b/c/CLAUDE.md']) {
    assert.equal(tocaArbitro([f]), true, f);
    assert.equal(juzga(buenas(), ctx({ ficheros: [f] })).ok, false, f);
  }
  assert.equal(tocaArbitro(['NO-CLAUDE.md', 'docs/CLAUDE.md.bak']), false);
});

test('veredicto: ningún texto del modelo se publica, solo ids de la lista de preguntas', () => {
  const clave = 'C1234567890-ghs_SECRETO';
  const clave2 = 'ghs_SECRETO_SUELTO';
  const r = buenas();
  const v = juzga([...r, { id: clave, respuesta: 'no', prueba: 'x' }, { id: clave2, respuesta: 'sí', prueba: 'x' }, { id: clave, respuesta: 'no', prueba: 'y' }, { id: { a: 1 }, respuesta: 'sí', prueba: 'x' }]);
  assert.equal(v.ok, false);
  const publicado = JSON.stringify(v);
  assert.doesNotMatch(publicado, /SECRETO/);
  assert.match(v.fallos.join(), /\d+ ids desconocidos/);
  for (const f of v.fallos) assert.match(f, /^(C\d+: [a-zá-ú ]+|\d+ ids desconocidos|la cabeza .*|no, requiere .*|salida ilegible)$/);
});

test('revisor.yml: el json-schema limita el id a C<número>', () => {
  assert.match(leer('.github/workflows/revisor.yml'), /"id":\{"type":"string","pattern":"\^C\[0-9\]\+\$"\}/);
});
