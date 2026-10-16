// Ratchet for the GitHub quota: no code file and no skill/agent instruction uses `--watch` with gh, nor runs
// `gh issue list` / `gh pr list` inside a loop. Why: in MenuPlan the GraphQL quota hit 0 twice (2026-10-10) because
// each `gh pr checks --watch` kept querying while it ran, per session; the figures are MenuPlan's, not verified in this repo.
// A text that explains why not to do it passes: comments in code, and the sections of SECCIONES_EXPLICATIVAS in .md.
// The fixtures are text in a temp directory: no real gh, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escanear, escanearTexto, PROPIOS, SECCIONES_EXPLICATIVAS } from '../scripts/lib/gh-quota.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

function conRepo(ficheros, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'fabrica-cuota-'));
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
const reglasDe = (ruta, texto) => escanearTexto(ruta, texto).sort((x, y) => x.linea - y.linea).map((h) => `${h.regla}@${h.linea}`);

// ---- good: must pass ----
const BUENO_JS = [
  "// never run gh pr checks --watch here: it keeps querying GraphQL",
  "/* for (const n of ns) { gh issue list } was the old way */",
  "import { spawnSync } from 'node:child_process';",
  "export const una = () => spawnSync('gh', ['pr', 'list', '--head', 'x']); // once, no loop",
  "const texto = 'a { brace in a string';",
  "for (const n of [1, 2]) { console.log(n); }",
  "export const luego = () => spawnSync('gh', ['issue', 'list']); // after the loop closed",
  "for (const n of [1, 2]) { spawnSync('gh', ['pr', 'view', String(n)]); }",
  "for (const n of [1, 2]) { spawnSync('gh', ['run', 'list']); }",
  "export const re = /[\"'{]/; const otra = () => spawnSync('gh', ['pr', 'list']);",
  '',
].join('\n');
const BUENO_SH = [
  '# do not: gh pr checks 3 --watch',
  'gh pr list --state open',
  'for n in 1 2; do echo $n; done',
  'gh issue list',
  'for n in 1 2; do gh pr view $n; done',
  'for n in 1 2; do echo $n; done; gh pr list',
  '',
].join('\n');
const BUENO_PS = [
  '# gh pr checks --watch is banned',
  'gh pr list',
  'foreach ($n in 1..3) { Write-Host "{$n} gh pr view $n" }',
  'gh issue list',
  '',
].join('\n');
const BUENO_MD = [
  '---',
  'name: x',
  '---',
  '# X',
  '## Operaciones habituales',
  '| Checks de un PR | `gh pr checks <n>` | `pass` |',
  '```',
  'gh pr list --head mi-rama',
  '# gh pr checks 3 --watch   (a comment)',
  '```',
  '## La cuota de GitHub',
  'No uses `gh pr checks --watch`: repite la consulta mientras corre.',
  '## Lo que falló',
  '- **2026-10-10 · cuota a 0.** Causa: `gh pr checks --watch` en cada sesión; `for n in 1 2; do gh issue list; done`.',
  '```',
  'for n in 1 2; do gh issue list; done',
  '```',
  '',
].join('\n');

// ---- bad: each on a known line ----
const MALO_SH = [
  'set -e',
  'gh pr checks 3 --watch',
  'for n in 1 2 3; do',
  '  gh issue list --json number',
  'done',
  'while true; do gh pr list; sleep 5; done',
  'git branch | xargs -I{} gh pr list --head {}',
  '',
].join('\n');
const MALO_JS = [
  "import { spawnSync } from 'node:child_process';",
  "spawnSync('gh', ['pr', 'checks', '3', '--watch']);",
  'const texto = "}";',
  'for (const n of [1, 2]) {',
  "  spawnSync('gh', ['issue', 'list']);",
  '}',
  "[1, 2].map((n) => run('gh pr list --head ' + n));",
  "setInterval(() => { run('gh issue list'); }, 1000);",
  "run('gh run watch 1 && gh pr checks 3 --watch');",
  'let i = 0;',
  'while (i++ < 3) run(`gh pr list`);',
  '',
].join('\n');
const MALO_PS = ['foreach ($b in $ramas) {', '  gh pr list --head $b', '}', 'gh pr checks 3 --watch', ''].join('\n');
const MALO_MD = [
  '# Skill',
  '## Operaciones habituales',
  '| Esperar | `gh pr checks <n> --watch` | verde |',
  'Espera con `gh pr checks 3 --watch` hasta que acabe.',
  '```sh',
  'for n in 1 2; do gh issue list; done',
  '```',
  '## Lo que falló',
  '- nada',
  '## Otra',
  'gh pr checks 9 --watch',
  '',
].join('\n');

test('good fixtures pass: the habit named in comments, loops closed before, gh pr view / gh run list in a loop, one list outside a loop', () => {
  assert.deepEqual(reglasDe('scripts/bueno.mjs', BUENO_JS), []);
  assert.deepEqual(reglasDe('scripts/bueno.sh', BUENO_SH), []);
  assert.deepEqual(reglasDe('apps/bueno.ps1', BUENO_PS), []);
  assert.deepEqual(reglasDe('.claude/skills/x/SKILL.md', BUENO_MD), []);
});

test('bad fixtures fail with the rule and the line: shell, JS (text and array form), PowerShell, markdown', () => {
  assert.deepEqual(reglasDe('scripts/malo.sh', MALO_SH), ['gh-watch@2', 'gh-list-in-loop@4', 'gh-list-in-loop@6', 'gh-list-in-loop@7']);
  assert.deepEqual(reglasDe('scripts/malo.mjs', MALO_JS), ['gh-watch@2', 'gh-list-in-loop@5', 'gh-list-in-loop@7', 'gh-list-in-loop@8', 'gh-watch@9', 'gh-list-in-loop@11']);
  assert.deepEqual(reglasDe('apps/malo.ps1', MALO_PS), ['gh-list-in-loop@2', 'gh-watch@4']);
  assert.deepEqual(reglasDe('.claude/skills/x/SKILL.md', MALO_MD), ['gh-watch@3', 'gh-watch@4', 'gh-list-in-loop@6', 'gh-watch@11']);
});

test('the same text anywhere in a lessons section passes; outside it, in the same file, it fails', () => {
  const dentro = '## Lo que falló\n- `gh pr checks 3 --watch` gastó la cuota.\n';
  const fuera = '## Operaciones\n- `gh pr checks 3 --watch` espera al CI.\n';
  assert.deepEqual(reglasDe('.claude/agents/a.md', dentro), []);
  assert.deepEqual(reglasDe('.claude/agents/a.md', fuera), ['gh-watch@2']);
  assert.deepEqual(SECCIONES_EXPLICATIVAS, ['Lo que falló', 'La cuota de GitHub']);
});

test('package.json scripts, workflows and hooks are code too; non-instruction files are not scanned', () => conRepo({
  'package.json': JSON.stringify({ scripts: { esperar: 'gh pr checks 3 --watch', bien: 'node x.js' } }),
  '.github/workflows/a.yml': 'jobs:\n  a:\n    steps:\n      - run: |\n          for n in 1 2; do\n            gh pr list\n          done\n',
  '.githooks/pre-push': 'gh pr checks --watch\n',
  'notas.txt': 'gh pr checks --watch',
  'CLAUDE.md': 'gh pr checks --watch',
  'test/fixtures/falso.mjs': MALO_JS,
}, (dir) => {
  assert.deepEqual(escanear(dir, {}).map((h) => `${h.fichero}:${h.linea}:${h.regla}`), [
    '.githooks/pre-push:1:gh-watch', '.github/workflows/a.yml:6:gh-list-in-loop', 'package.json:1:gh-watch',
  ]);
}));

test('a file that cannot be read as code is a finding, not a silent skip', () => conRepo({ 'scripts/roto.mjs': "const a = 'sin cerrar;\n", '.claude/skills/x/SKILL.md': '```\nsin cerrar\n' }, (dir) => {
  assert.deepEqual(escanear(dir, {}).map((h) => [h.fichero, h.regla]), [['.claude/skills/x/SKILL.md', 'unreadable'], ['scripts/roto.mjs', 'unreadable']]);
}));

test('PROPIOS is closed and has no dead entries: each file exists, has a reason and really spells the habits', () => {
  for (const [ruta, razon] of Object.entries(PROPIOS)) {
    assert.ok(existsSync(join(RAIZ, ruta)), `${ruta} does not exist: remove it from PROPIOS`);
    assert.ok(typeof razon === 'string' && razon.length > 10, `${ruta}: a reason is required`);
  }
  const sinLista = new Set(escanear(RAIZ, {}).map((h) => h.fichero));
  for (const ruta of Object.keys(PROPIOS)) assert.ok(sinLista.has(ruta), `${ruta} no longer needs its entry: remove it from PROPIOS`);
});

test('the real repo passes: no --watch with gh and no gh issue/pr list inside a loop in code, skills or agents', () => {
  const hallazgos = escanear(RAIZ);
  assert.deepEqual(hallazgos.map(formato), [], 'Check CI once, at the end, over REST (rules in the github skill, "La cuota de GitHub"); read one issue/PR with gh api repos/<repo>/issues/<n>.');
});
