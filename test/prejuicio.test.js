// scripts/prejuicio.mjs: the judge of CI run locally. No test calls claude or the repo's git: the executor, git and the export of the
// judge are injected. The judge's files are the real ones of this checkout, so the instructions the test sees are the ones CI would use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JUDGE_PATHS, STANDARD, WORKFLOW_REL } from '../scripts/golden.mjs';
import { JUDGE_DIR, readReviewer } from '../scripts/golden-run.mjs';
import { CASE_FILE } from '../scripts/lib/golden-guard.mjs';
import { cliPrejuicio } from '../scripts/prejuicio.mjs';
import { EXIT } from '../scripts/lib/exit.mjs';
import { CHECKED_BY } from '../scripts/lib/questions.mjs';
import { ANSWER } from '../scripts/lib/record.mjs';
import { cargarPreguntas } from '../scripts/veredicto.mjs';

const RAIZ = path.join(import.meta.dirname, '..');
// What the judge of the base is made of: JUDGE_PATHS of golden.mjs (a «/**» is a folder), never a list of our own.
const GLOB = '/**';
const JUEZ = JUDGE_PATHS.map((p) => (p.endsWith(GLOB) ? p.slice(0, -GLOB.length) : p));
const IDS = cargarPreguntas(STANDARD, RAIZ).filter((q) => q.quien === CHECKED_BY.reviewer).map((q) => q.id);
const SHA = 'a'.repeat(40);
const DIFF = 'diff --git a/x b/x\n+cambio\n';
const BODY = '## What changes\n\ncuerpo en borrador\n';

const casa = mkdtempSync(path.join(tmpdir(), 'prejuicio-test-'));
const body = path.join(casa, 'cuerpo.md');
writeFileSync(body, BODY);
test.after(() => rmSync(casa, { recursive: true, force: true }));

const gitFalso = ({ sucio = '', diff = DIFF } = {}) => (args) => ({ status: sucio, diff, 'rev-parse': `${SHA}\n` })[args[0]];
const exportFalso = (ref, dir) => {
  const tree = path.join(dir, 'judge');
  for (const f of JUEZ) {
    mkdirSync(path.dirname(path.join(tree, f)), { recursive: true });
    cpSync(path.join(RAIZ, f), path.join(tree, f), { recursive: true });
  }
  return tree;
};
const respuestas = (cambios = {}) => JSON.stringify({ respuestas: IDS.map((id) => ({ id, respuesta: cambios[id] ?? ANSWER.yes, prueba: `prueba de ${id}` })) });
// An executor that records what the judge would have seen, while its workspace still exists.
function ejecutor(texto) {
  const visto = { llamadas: 0 };
  const run = ({ reviewer, workspace }) => {
    visto.llamadas += 1;
    visto.workspace = workspace;
    visto.reviewer = reviewer;
    visto.diff = readFileSync(path.join(workspace, CASE_FILE.diff), 'utf8');
    visto.body = readFileSync(path.join(workspace, CASE_FILE.body), 'utf8');
    visto.juez = JUEZ.every((f) => existsSync(path.join(workspace, JUDGE_DIR, f))) && existsSync(path.join(workspace, JUDGE_DIR, ...STANDARD.split('/')));
    if (texto instanceof Error) throw texto;
    return { text: texto, cost: 0.5 };
  };
  return { run, visto };
}
const pasar = (argv, e, git = gitFalso()) => cliPrejuicio(argv, { run: e.run, claude: {}, gitOut: git, exportTree: exportFalso });

test('a clean pass: the judge gets the diff, the draft body and the judge of the base; exit OK, one call, workspace removed', () => {
  const e = ejecutor(respuestas());
  const r = pasar(['--json', '--body-file', body], e);
  assert.equal(r.code, EXIT.OK, r.stderr);
  assert.equal(JSON.parse(r.stdout).veredicto, ANSWER.yes);
  assert.deepEqual([e.visto.llamadas, e.visto.diff, e.visto.body, e.visto.juez], [1, DIFF, BODY, true]);
  assert.deepEqual(e.visto.reviewer, readReviewer(path.join(RAIZ, ...WORKFLOW_REL.split('/'))), 'same prompt, model and schema as CI');
  assert.equal(existsSync(e.visto.workspace), false);
});

test('a «no»: exit PREJUICIO_NO, and stderr names each «no» with its proof (all of them, not the first)', () => {
  const [a, b] = IDS;
  const r = pasar(['--body-file', body], ejecutor(respuestas({ [a]: ANSWER.no, [b]: ANSWER.no })));
  assert.equal(r.code, EXIT.PREJUICIO_NO);
  for (const id of [a, b]) assert.ok(r.stderr.includes(`${id}: ${ANSWER.no}`) && r.stderr.includes(`prueba de ${id}`), id);
  const j = pasar(['--json', '--body-file', body], ejecutor(respuestas({ [a]: ANSWER.no })));
  assert.deepEqual([j.code, JSON.parse(j.stdout).error], [EXIT.PREJUICIO_NO, 'PREJUICIO_NO']);
});

test('a yes without proof or a missing answer is a «no», as it is in CI', () => {
  const sinPrueba = JSON.stringify({ respuestas: IDS.map((id) => ({ id, respuesta: ANSWER.yes, prueba: id === IDS[0] ? ' ' : 'x' })) });
  assert.ok(pasar(['--body-file', body], ejecutor(sinPrueba)).stderr.includes(`${IDS[0]}: sin prueba`));
  const falta = JSON.stringify({ respuestas: [] });
  const r = pasar(['--body-file', body], ejecutor(falta));
  assert.equal(r.code, EXIT.PREJUICIO_NO);
  assert.ok(r.stderr.includes(`${IDS[0]}: sin respuesta`));
});

test('claude failing or an unreadable output is PREJUICIO_FAILED, never a «sí»', () => {
  for (const e of [ejecutor(new Error('claude failed (exit 1)')), ejecutor('esto no es json')]) {
    const r = pasar(['--body-file', body], e);
    assert.equal(r.code, EXIT.PREJUICIO_FAILED, r.stderr);
  }
});

test('refuses before spending a call: uncommitted changes, an empty diff, a missing body file, missing arguments', () => {
  const e = ejecutor(respuestas());
  assert.equal(pasar(['--body-file', body], e, gitFalso({ sucio: ' M x\n' })).code, EXIT.UNSAVED_CHANGES);
  assert.equal(pasar(['--body-file', body], e, gitFalso({ diff: '' })).code, EXIT.USAGE);
  assert.equal(pasar(['--body-file', path.join(casa, 'no-existe.md')], e).code, EXIT.USAGE);
  assert.equal(pasar([], e).code, EXIT.USAGE);
  assert.equal(pasar(['--body-file'], e).code, EXIT.USAGE);
  assert.equal(e.visto.llamadas, 0);
});

test('the constructor is told to run it, and the command is in package.json', () => {
  const pkg = JSON.parse(readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.prejuicio, 'node scripts/prejuicio.mjs');
  assert.ok(readFileSync(path.join(RAIZ, '.claude', 'agents', 'constructor.md'), 'utf8').includes('npm run prejuicio'));
});

test('the real entry (npm run prejuicio): without its body file it refuses with USAGE and calls nothing', () => {
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'prejuicio.mjs'), '--json'], { encoding: 'utf8', cwd: RAIZ });
  assert.equal(r.status, EXIT.USAGE, r.stderr);
  assert.deepEqual([JSON.parse(r.stdout).ok, JSON.parse(r.stdout).error], [false, 'USAGE']);
});
