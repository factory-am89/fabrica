// Lo que la Fábrica se exige a sí misma, comprobado por máquina (principio 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { decidir, leerPreguntas } from '../scripts/veredicto.mjs';
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

test('el estándar tiene al menos 10 preguntas, C1..Cn seguidas, cada una con bien y mal', () => {
  assert.ok(preguntas.length >= 10, `hay ${preguntas.length}`);
  assert.deepEqual(preguntas.map((p) => p.id), preguntas.map((_, i) => `C${i + 1}`));
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

test('PASOS-PABLO manda al script real; arranque ejecuta environment, apps, subida y ruleset en ese orden', () => {
  const pasos = leer('PASOS-PABLO.md');
  // La ruta exacta que se pega en PowerShell, y que el fichero existe en el repo.
  const orden1 = 'powershell -ExecutionPolicy Bypass -File C:\\dev\\fabrica-v0-revisor\\apps\\arranque.ps1';
  assert.ok(pasos.includes(orden1), 'PASOS-PABLO no trae la orden exacta del paso 1');
  assert.ok(existsSync(new URL('../apps/arranque.ps1', import.meta.url)));
  assert.match(pasos, /Ningún constructor trabaja antes de que exista el ruleset/);
  assert.ok(pasos.includes('C:\\dev\\fabrica\\apps\\'), 'falta dónde vive el script tras fusionar');
  const arranque = leer('apps/arranque.ps1');
  // Orden de EJECUCIÓN: las llamadas `Paso '…'` del cuerpo, no la tabla de estado de arriba.
  const ejecutados = [...arranque.matchAll(/^\s*Paso '([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual(ejecutados, [
    '1 Sesion de gh',
    '2 Environment revisor (main)',
    '3 Cuenta de servicio (llavero)',
    '3 App fabrica-constructor',
    '3 App fabrica-revisor',
    '4 Apps instaladas en el repo',
    '5 Token de Claude',
    '6 Allow auto-merge',
    '7 Subir main (v0)',
    '8 Ruleset de main',
  ]);
  assert.ok(arranque.indexOf('environments/revisor') < arranque.indexOf("Paso '3 App fabrica-revisor'"));
  assert.match(arranque, /ruleset\.ps1'\) -Repo .* -SesionAbierta/);
  assert.doesNotMatch(arranque, /node\s+'scripts/, 'el script de admin no saca la clave de 1Password');
  assert.doesNotMatch(arranque, /&\s*gh auth login/, 'el login va por Gh-Login, que no deja helper en git');
  assert.match(leer('apps/lib-gh.ps1'), /auth login/);
  const ruleset = leer('apps/ruleset.ps1');
  assert.doesNotMatch(ruleset, /check-runs/, 'el check revisor no debe haber corrido antes: solo corre en PR');
  assert.match(ruleset, /context = 'revisor'; integration_id = \$idRevisor/);
  assert.match(ruleset, /type = 'non_fast_forward'/);
  assert.match(ruleset, /type = 'deletion'/);
  assert.doesNotMatch(ruleset, /type = 'update'/);
  assert.match(ruleset, /bypass_actors = @\(\)/);
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
const ctx = (extra = {}) => ({ sha: SHA, cabeza: SHA, ...extra });
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

test('veredicto: con todo sí y el SHA correcto es sí, sea cual sea el diff; sin una respuesta sigue siendo no', () => {
  assert.equal(juzga(buenas()).ok, true);
  assert.equal(juzga(buenas().slice(1)).ok, false);
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

test('CLAUDE.md, PASOS-PABLO.md y apps/*.ps1 no llevan caracteres de control', () => {
  const ps1 = readdirSync(new URL('../apps/', import.meta.url)).filter((f) => f.endsWith('.ps1')).map((f) => `apps/${f}`);
  assert.ok(ps1.length >= 3, 'no encuentro los .ps1 de apps/');
  for (const f of ['CLAUDE.md', 'PASOS-PABLO.md', ...ps1]) assert.doesNotMatch(leer(f), /[\x00-\x08\x0b\x0c\x0e-\x1f]/, f); // eslint-disable-line no-control-regex
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
