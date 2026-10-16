// The revisor.yml workflow and the rule C4 exception, checked by machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { accionFijada } from '../scripts/lib/actions.mjs';
import { REPO } from '../scripts/lib/repo.mjs';
import { leer } from './apoyo/fabrica.mjs';

// Los workflows se comprueban (permisos y SHA, C4) en test/workflows.test.js, que también sirve
// para el repo que llama a tests.yml; aquí solo la regla de la excepción.
test('C4: la única excepción al SHA es un workflow de la Fábrica con @main, y nada más', () => {
  const sha = 'a'.repeat(40);
  for (const bien of [`actions/checkout@${sha}`, `${REPO}/.github/workflows/tests.yml@main`, `${REPO}/.github/workflows/revisor.yml@main`]) {
    assert.equal(accionFijada(bien), true, bien);
  }
  for (const mal of [
    'actions/checkout@v7', 'actions/checkout@main', // una acción de otro repo, sin SHA
    'otro/fabrica/.github/workflows/tests.yml@main', // otro repo
    `${REPO}x/.github/workflows/tests.yml@main`, // repo con el mismo prefijo
    `${REPO}/.github/workflows/tests.yml@v1`, // otra referencia
    `${REPO}/.github/workflows/tests.yml@master`,
    `${REPO}/.github/actions/x@main`, // otra ruta
    `${REPO}/scripts/x.yml@main`,
    `${REPO}/.github/workflows/../../x.yml@main`, // salida de la carpeta
    `${REPO}/.github/workflows/sub/x.yml@main`,
    './.github/workflows/tests.yml', // local, sin referencia
  ]) {
    assert.equal(accionFijada(mal), false, mal);
  }
});

test('el estándar escribe la excepción de C4 con el repo de scripts/lib/repo.mjs', () => {
  assert.ok(leer('standards/code.md').includes(`${REPO}/.github/workflows/<fichero>.yml@main`), 'la excepción del estándar no coincide con REPO');
});

test('revisor.yml es reutilizable y baja la Fábrica a .fabrica/ en su propio commit', () => {
  const texto = leer('.github/workflows/revisor.yml');
  assert.match(texto, /^ {2}workflow_call:/m, 'sin workflow_call no se puede llamar desde otro repo');
  const checkout = texto.split(/^ {6}- /m).find((b) => b.includes('path: .fabrica'));
  assert.ok(checkout, 'falta el checkout de la Fábrica en .fabrica/');
  assert.ok(checkout.includes(`repository: ${REPO}`), 'el checkout de .fabrica no fija repository: la Fábrica');
  assert.match(checkout, /ref: \$\{\{ job\.workflow_sha \}\}/, 'la Fábrica debe bajarse en el commit del workflow llamado');
  assert.match(texto, /node \.fabrica\/scripts\/veredicto\.mjs/);
  assert.match(texto, /\.fabrica\/\.claude\/agents\/revisor\.md/);
  assert.match(texto, /\.fabrica\/standards\/code\.md/);
  assert.doesNotMatch(texto, /node scripts\/veredicto/, 'la ruta sin .fabrica/ bajaría el repo que llama');
});

test('revisor.yml usa pull_request_target, no baja el código del PR y guarda los secretos en el environment revisor', () => {
  const texto = leer('.github/workflows/revisor.yml');
  assert.match(texto, /^on:\s*\n(\s*#.*\n)*\s+pull_request_target:/m);
  const tipos = texto.match(/^ {4}types: \[(.*)\]$/m);
  assert.ok(tipos, 'pull_request_target needs an explicit types list');
  assert.deepEqual(
    tipos[1].split(',').map((s) => s.trim()),
    ['opened', 'synchronize', 'reopened', 'ready_for_review', 'edited'],
    'the reviewer must rejudge when the PR body or title is edited'
  );
  // Único `ref:` permitido: el de la Fábrica en .fabrica/ (job.workflow_sha); ninguno trae el código del PR.
  const refs = [...texto.matchAll(/^\s*ref:\s*(.*)$/gm)].map((m) => m[1].trim());
  assert.deepEqual(refs, ['${{ job.workflow_sha }}'], 'un checkout con otro ref: podría traer el código del PR');
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

test('revisor.yml: el paso del veredicto define STANDARD con el estándar de código', () => {
  const pasos = Object.values(yaml.load(leer('.github/workflows/revisor.yml')).jobs).flatMap((j) => j.steps);
  const paso = pasos.find((p) => String(p.run ?? '').includes('veredicto.mjs'));
  assert.equal(paso?.env?.STANDARD, '.fabrica/standards/code.md');
});

// The reviewer model answers the questions of the standard named in the prompt and the judge checks
// them against STANDARD: both must name the same file (C8).
test('revisor.yml: el estándar del prompt es el mismo que STANDARD', () => {
  const pasos = Object.values(yaml.load(leer('.github/workflows/revisor.yml')).jobs).flatMap((j) => j.steps);
  const standard = pasos.find((p) => String(p.run ?? '').includes('veredicto.mjs'))?.env?.STANDARD;
  const prompt = pasos.map((p) => p.with?.prompt).find((x) => typeof x === 'string');
  assert.ok(standard && prompt, 'falta STANDARD o el prompt');
  const nombrados = [...new Set(prompt.match(/\.fabrica\/standards\/[a-z0-9-]+\.md/g) ?? [])];
  assert.deepEqual(nombrados, [standard]);
});

test('revisor.yml: el json-schema limita el id a C<número>', () => {
  assert.match(leer('.github/workflows/revisor.yml'), /"id":\{"type":"string","pattern":"\^C\[0-9\]\+\$"\}/);
});
