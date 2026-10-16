// One door to 1Password and to the Windows credential vault: no code file outside the closed allow-list
// (PUERTAS in scripts/lib/puerta-op.mjs) spawns `op`, opens the vault or calls the functions that do.
// Why: on 2026-10-16 agents in a loop spent the shared 1Password quota from places nobody was counting.
// No real `op` and no real vault are touched: the fixtures are text in a temp directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escanear, escanearTexto, FUNCIONES_PUERTA, PUERTAS } from '../scripts/lib/puerta-op.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

// A temp repo with the given files ({ ruta: texto }).
function conRepo(ficheros, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'fabrica-puerta-'));
  try {
    for (const [ruta, texto] of Object.entries(ficheros)) {
      mkdirSync(dirname(join(dir, ruta)), { recursive: true });
      writeFileSync(join(dir, ruta), texto);
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const formato = (h) => `${h.fichero}:${h.linea} [${h.regla}] ${h.texto}`;

// (a) Mentions of `op` that are not calls: comments, strings about docs, comparisons, regexes, markdown, fixtures.
const BUENO_JS = [
  "// we use op to read keys; `op document get x` is slow, see the 1password skill",
  "/* spawnSync('op', ['read']) was here once",
  "   and PasswordVault.Retrieve too */",
  "export const ayuda = 'to read it by hand run op document get on your own';",
  'export const url = "https://example.com/op"; // not a comment start inside the string',
  "export const esOp = (x) => x === 'op' || x !== 'op.exe';",
  "export const re = /['\"]op['\"]/; // quotes inside a regex must not open a string",
  'export const mitad = 6 / 2 / 1; // division, not a regex',
  '',
].join('\n');
const BUENO_PS = [
  '# & op document get x   (a comment)',
  '<# block comment:',
  '& op vault list',
  '[Windows.Security.Credentials.PasswordVault] #>',
  'Write-Host "Install op first, then open a new terminal"   # op signin',
  '',
].join('\n');

// (b) What must be caught, each on a known line.
const MALO_JS = [
  "import { spawnSync } from 'node:child_process';",
  '',
  "const r = spawnSync('op', ['read', 'x']);",
  '',
  'export default r;',
].join('\n');
const MALO_EXEC = "import { execSync } from 'node:child_process';\nexecSync('op read op://Fabrica/x/y');\n";
const MALO_BOVEDA_JS = "// reading the token\nconst ps = '$v = New-Object Windows.Security.Credentials.PasswordVault; $v.Retrieve(a, b)';\n";
const MALO_PS = ['$ErrorActionPreference = "Stop"', '', '& op document get fabrica-constructor.pem --vault Fabrica', ''].join('\n');
const MALO_BOVEDA_PS = '$v = New-Object Windows.Security.Credentials.PasswordVault\n$c = $v.Retrieve("x", "y")\n';
const MALO_SH = 'set -e\nnpm ci && op run --env-file=.env -- node x.js\n';
// The case that happened: a test that calls a function that opens the vault (no token in the env, no fake injected).
const MALO_TEST = [
  "import { test } from 'node:test';",
  "import { tokenServicio } from '../scripts/token.mjs';",
  '',
  "test('reads the service account', () => {",
  '  tokenServicio({});',
  '});',
].join('\n');

test('good fixture passes: `op` only in comments, docs strings, comparisons and regexes; non-code files are not scanned', () => conRepo({
  'scripts/bueno.mjs': BUENO_JS,
  'apps/bueno.ps1': BUENO_PS,
  'README.md': "```js\nspawnSync('op', ['read'])\n$v.Retrieve('a','b')\n```\n",
  'test/fixtures/falso.mjs': MALO_JS,
  'notas.txt': 'op document get x',
}, (dir) => {
  assert.deepEqual(escanear(dir, { lectores: {}, pruebas: {} }).map(formato), []);
}));

test('bad fixture fails with file:line: spawn of op, exec of op, PasswordVault/Retrieve, shell, powershell', () => conRepo({
  'scripts/malo.mjs': MALO_JS,
  'scripts/malo-exec.mjs': MALO_EXEC,
  'scripts/malo-boveda.mjs': MALO_BOVEDA_JS,
  'apps/malo.ps1': MALO_PS,
  'apps/malo-boveda.ps1': MALO_BOVEDA_PS,
  '.githooks/pre-push': MALO_SH,
}, (dir) => {
  const por = Object.fromEntries(escanear(dir, { lectores: {}, pruebas: {} }).map((h) => [`${h.fichero}:${h.linea}`, h.regla]));
  assert.deepEqual(por, {
    'scripts/malo.mjs:3': 'spawns-op',
    'scripts/malo-exec.mjs:2': 'spawns-op',
    'scripts/malo-boveda.mjs:2': 'opens-vault',
    'apps/malo.ps1:3': 'spawns-op',
    'apps/malo-boveda.ps1:1': 'opens-vault',
    'apps/malo-boveda.ps1:2': 'opens-vault',
    '.githooks/pre-push:2': 'spawns-op',
  });
}));

test('the case that happened: a test outside the allow-list that calls tokenServicio / leerLlavero / clavePrivada is caught', () => {
  for (const nombre of FUNCIONES_PUERTA) {
    const h = escanearTexto('test/nuevo.test.js', `import { x } from '../scripts/token.mjs';\n${nombre}();\n`);
    assert.deepEqual(h.map((x) => [x.regla, x.linea]), [['uses-door-function', 2]], nombre);
  }
  conRepo({ 'test/nuevo.test.js': MALO_TEST }, (dir) => {
    assert.deepEqual(escanear(dir, PUERTAS).map(formato), [
      "test/nuevo.test.js:2 [uses-door-function] import { tokenServicio } from '../scripts/token.mjs';",
      'test/nuevo.test.js:5 [uses-door-function] tokenServicio({});',
    ]);
  });
});

test('a file inside the allow-list is not reported; the same text anywhere else is', () => conRepo({
  'scripts/token.mjs': MALO_JS,
  'scripts/otro.mjs': MALO_JS,
}, (dir) => {
  assert.deepEqual(escanear(dir, PUERTAS).map((h) => h.fichero), ['scripts/otro.mjs']);
}));

test('a code file the scanner cannot read as code is a finding, not a silent skip', () => conRepo({ 'scripts/roto.mjs': "const a = 'sin cerrar;\n" }, (dir) => {
  const [h] = escanear(dir, PUERTAS);
  assert.equal(h.fichero, 'scripts/roto.mjs');
  assert.equal(h.regla, 'unreadable');
}));

test('package.json scripts are shell commands: `op` there is caught', () => conRepo({ 'package.json': JSON.stringify({ scripts: { leer: 'op read op://a/b/c', ok: 'node x.js' } }) }, (dir) => {
  assert.deepEqual(escanear(dir, PUERTAS).map((h) => [h.fichero, h.regla]), [['package.json', 'spawns-op']]);
}));

test('the allow-list is closed and has no dead entries: every path exists, has a reason, and really needs its entry', () => {
  const todos = { ...PUERTAS.lectores, ...PUERTAS.pruebas };
  for (const [ruta, razon] of Object.entries(todos)) {
    assert.ok(!/[*?]/.test(ruta), `${ruta}: no wildcards`);
    assert.ok(existsSync(join(RAIZ, ruta)), `${ruta} does not exist: remove it from the allow-list`);
    assert.ok(typeof razon === 'string' && razon.length > 10, `${ruta}: a reason is required`);
  }
  const sinLista = new Set(escanear(RAIZ, { lectores: {}, pruebas: {} }).map((h) => h.fichero));
  for (const ruta of Object.keys(todos)) assert.ok(sinLista.has(ruta), `${ruta} no longer touches the door: remove it from the allow-list`);
});

test('the real repo passes: nothing outside the allow-list spawns op, opens the vault or calls the functions that do', () => {
  const hallazgos = escanear(RAIZ);
  assert.deepEqual(hallazgos.map(formato), [], 'Open the door only through scripts/token.mjs (cache + read budget). If a new file must, add it to PUERTAS with a reason.');
});
