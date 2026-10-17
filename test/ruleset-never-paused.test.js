// lesson: ruleset-pause-merges-armed
// The ruleset of `main` is never paused, relaxed or deleted by code (intervenciones.md, row of 2026-10-17; rule in
// standards/intervention.md, «Who decides a merge»). Pausing it let #20 and #52 in without the `revisor` check, and the
// key of the administrator App would be one pushed workflow away. This scans the code under apps/, scripts/ and .github/
// for two things: a ruleset written with an `enforcement` other than `active`, and a DELETE sent to a rulesets endpoint.
// No network, no clock: the real tree is read, the bad cases are text fixtures in memory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const CARPETAS = ['apps', 'scripts', '.github'];
const EXTENSIONES = /\.(mjs|cjs|js|ps1|psm1|sh|ya?ml|json)$/;

// `enforcement = 'x'`, `enforcement: "x"`, `-f enforcement=x`, `"enforcement": "x"`; comparisons (`-ne`, `!==`, `===`) are reads.
const ESCRIBE_ENFORCEMENT = /enforcement["']?\s*[=:]\s*["']?([A-Za-z_]+)/g;
// A method flag followed by DELETE: `-X DELETE`, `'-X', 'DELETE'`, `--method=DELETE`, `-Method Delete`, `method: 'DELETE'`.
const METODO_DELETE = /(?:-X|--method|-Method|\bmethod)["']?\s*[,=: ]\s*["']?DELETE\b/i;
const VENTANA_LINEAS = 3;

export function escanearTexto(ruta, texto) {
  const lineas = texto.split('\n');
  const hallazgos = [];
  lineas.forEach((linea, i) => {
    for (const m of linea.matchAll(ESCRIBE_ENFORCEMENT)) {
      if (m[1] !== 'active') hallazgos.push({ fichero: ruta, linea: i + 1, regla: 'enforcement-not-active', texto: linea.trim() });
    }
    if (METODO_DELETE.test(linea)) {
      const cerca = lineas.slice(Math.max(0, i - VENTANA_LINEAS), i + VENTANA_LINEAS + 1).join('\n');
      if (/rulesets/i.test(cerca)) hallazgos.push({ fichero: ruta, linea: i + 1, regla: 'delete-ruleset', texto: linea.trim() });
    }
  });
  return hallazgos;
}

function ficheros(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules') return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? ficheros(p) : EXTENSIONES.test(e.name) ? [p] : [];
  });
}

export function escanear(raiz) {
  return CARPETAS.flatMap((c) => {
    try { return ficheros(join(raiz, c)); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  }).flatMap((p) => escanearTexto(relative(raiz, p).split(sep).join('/'), readFileSync(p, 'utf8')));
}

const formato = (h) => `${h.fichero}:${h.linea} [${h.regla}] ${h.texto}`;

test('the real tree writes no ruleset that is not active and deletes none (apps/ruleset.ps1 creates it active)', () => {
  assert.deepEqual(escanear(RAIZ).map(formato), []);
  assert.match(readFileSync(join(RAIZ, 'apps/ruleset.ps1'), 'utf8'), /rulesets/, 'the scanner must be looking at the file that creates the ruleset');
});

test('good fixtures pass: active, reads and comparisons, a DELETE far from any ruleset', () => {
  const bueno = [
    "$cuerpo = @{ name = 'main'; enforcement = 'active' }",
    "const body = { enforcement: 'active' };",
    "-f enforcement=active",
    "if (main.enforcement !== 'active') throw new Error('x');",
    "if (-not $jv -or $jv.enforcement -ne 'active') { throw 'x' }",
    "if (r.enforcement === 'disabled') return;",
    "gh api repos/o/r/rulesets",
  ].join('\n');
  assert.deepEqual(escanearTexto('scripts/bueno.mjs', bueno), []);
  assert.deepEqual(escanearTexto('scripts/bueno2.mjs', 'gh api -X DELETE repos/o/r/git/refs/heads/old'), []);
});

test('bad fixtures fail with file:line: enforcement other than active, in every spelling', () => {
  const casos = {
    "$cuerpo = @{ enforcement = 'disabled' }": 'enforcement-not-active',
    "const body = { enforcement: 'evaluate' };": 'enforcement-not-active',
    'gh api -X PUT repos/o/r/rulesets/1 -f enforcement=disabled': 'enforcement-not-active',
    '{ "enforcement": "disabled" }': 'enforcement-not-active',
    "ruleset.enforcement = 'disabled';": 'enforcement-not-active',
  };
  for (const [texto, regla] of Object.entries(casos)) {
    assert.deepEqual(escanearTexto('scripts/malo.mjs', `// l1\n${texto}\n`).map((h) => [h.linea, h.regla]), [[2, regla]], texto);
  }
});

test('bad fixtures fail with file:line: DELETE to a rulesets endpoint, in every spelling', () => {
  const casos = [
    'gh api -X DELETE repos/o/r/rulesets/12',
    'gh api --method DELETE repos/o/r/rulesets/12',
    'gh api --method=DELETE "repos/$Repo/rulesets/$id"',
    "spawnSync('gh', ['api', '-X', 'DELETE', `repos/${repo}/rulesets/${id}`]);",
    "Gh @('api', '-X', 'DELETE', \"repos/$Repo/rulesets/$id\")",
    "await fetch(url + '/rulesets/1', { method: 'DELETE' });",
    "      run: gh api -X DELETE /repos/${{ github.repository }}/rulesets/${{ env.ID }}",
  ];
  for (const texto of casos) {
    const h = escanearTexto('.github/workflows/malo.yml', `a\n${texto}\n`);
    assert.deepEqual(h.map((x) => [x.linea, x.regla]), [[2, 'delete-ruleset']], texto);
  }
  // The endpoint on the line after the method flag still counts.
  const dos = escanearTexto('scripts/malo.mjs', "run(['api', '-X', 'DELETE',\n  `repos/${r}/rulesets/${id}`]);\n");
  assert.deepEqual(dos.map((x) => x.regla), ['delete-ruleset']);
});
