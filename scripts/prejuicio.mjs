// Prejuicio: the SAME judge as CI (the `revisor` workflow's step `claude`), run locally before opening a PR or pushing a fix, on
// `git diff <base>...HEAD` and the draft body of the PR (a file). Prints the verdict and every «no» with its proof, so they are all fixed at once.
//   node scripts/prejuicio.mjs --body-file <body.md> [--base origin/main] [--json]   (output rule and exit codes: scripts/lib/exit.mjs)
// It does not replace the revisor of CI: it is another context with the same instructions (revisor.md, standards/code.md, the
// schema, the model, the prompt: exported from <base> and read by scripts/golden-run.mjs, which is the only place that knows how to call claude).
// Cost: one call of the subscription per pass (`claude -p`, the session's own login). Fails loud: claude failing or an unreadable output is
// PREJUICIO_FAILED, never a «sí»; a verdict «no» is PREJUICIO_NO with each «no» and its proof in stderr.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STANDARD } from './golden.mjs';
import { WORKFLOW_REL, callClaude, exportJudge, readReviewer, resolveClaude } from './golden-run.mjs';
import { ExitError, finish, runCommand } from './lib/exit.mjs';
import { MAIN_REF } from './lib/repo.mjs';
import { ANSWER } from './lib/record.mjs';
import { cargarPreguntas, decidir } from './veredicto.mjs';

const REPO = path.resolve(import.meta.dirname, '..');
export const DEFAULT_BASE = MAIN_REF;
const BODY_FLAG = '--body-file';
const BASE_FLAG = '--base';

export function git(args) {
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new ExitError('GIT_FAILED', `git ${args.join(' ')} failed: ${r.error?.message ?? r.stderr.trim()}`);
  return r.stdout;
}

// argv without --json -> { bodyFile, base }; anything else is a USAGE error.
export function parseArgs(args) {
  const out = { bodyFile: null, base: DEFAULT_BASE };
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === BODY_FLAG && args[i + 1] !== undefined) out.bodyFile = args[i + 1];
    else if (args[i] === BASE_FLAG && args[i + 1] !== undefined) out.base = args[i + 1];
    else throw new ExitError('USAGE', `usage: prejuicio ${BODY_FLAG} <body.md> [${BASE_FLAG} <ref>] [--json]`);
  }
  if (out.bodyFile === null) throw new ExitError('USAGE', `${BODY_FLAG} <body.md> is required: the draft body of the PR`);
  return out;
}

// What the judge said, in the closed vocabulary: the verdict and each question that is not a clean yes, with the proof it gave.
export function report(output, preguntas, sha) {
  const v = decidir(output, preguntas, { sha, cabeza: sha });
  if (v.respuestas === null) throw new ExitError('PREJUICIO_FAILED', 'the output of the judge is not readable (not JSON)');
  const porId = new Map((JSON.parse(output).respuestas ?? []).map((r) => [r.id, r]));
  const nos = v.fallos.map((fallo) => {
    const id = fallo.split(':')[0];
    const q = preguntas.find((p) => p.id === id);
    return { id, fallo, pregunta: q?.pregunta ?? null, prueba: porId.get(id)?.prueba ?? null };
  });
  return { veredicto: v.ok ? ANSWER.yes : ANSWER.no, nos };
}

export const humanNos = (nos) => nos.map((n) => `${n.fallo}${n.pregunta ? ` | ${n.pregunta}` : ''}${n.prueba ? `\n    prueba: ${n.prueba}` : ''}`).join('\n');

// Injected for the tests, which call neither claude nor the repo's git: `run` is the executor of the judge ({ claude, reviewer, workspace } -> { text, cost }),
// `gitOut` answers the git questions (args -> stdout) and `exportTree` puts the judge of <base> in a folder (ref, dir -> tree). The real ones are the defaults.
export function prejuicio({ bodyFile, base = DEFAULT_BASE, run = callClaude, claude = null, gitOut = git, exportTree = exportJudge }) {
  if (!existsSync(bodyFile)) throw new ExitError('USAGE', `${BODY_FLAG}: ${bodyFile} does not exist`);
  if (gitOut(['status', '--porcelain']).trim() !== '') throw new ExitError('UNSAVED_CHANGES', 'there are uncommitted changes: the judge sees the commits only (git diff base...HEAD); commit them first');
  const diff = gitOut(['diff', `${base}...HEAD`]);
  if (diff.trim() === '') throw new ExitError('USAGE', `git diff ${base}...HEAD is empty: there is nothing to judge`);
  const sha = gitOut(['rev-parse', 'HEAD']).trim();
  const root = mkdtempSync(path.join(tmpdir(), 'fabrica-prejuicio-'));
  try {
    const tree = exportTree(base, root); // the judge of CI is the one on main: instructions, standard and workflow come from <base>
    const workspace = path.join(root, 'w');
    mkdirSync(workspace);
    cpSync(tree, path.join(workspace, '.fabrica'), { recursive: true });
    writeFileSync(path.join(workspace, 'pr.diff'), diff);
    writeFileSync(path.join(workspace, 'body.md'), readFileSync(bodyFile, 'utf8'));
    const reviewer = readReviewer(path.join(tree, ...WORKFLOW_REL.split('/')));
    const preguntas = cargarPreguntas(STANDARD, tree);
    let result;
    try {
      result = run({ claude: claude ?? resolveClaude(), reviewer, workspace });
    } catch (e) {
      throw new ExitError('PREJUICIO_FAILED', e.message);
    }
    return { ...report(result.text, preguntas, sha), sha, base, cost: result.cost };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export const humanPrejuicio = (r) => `prejuicio: veredicto ${r.veredicto} sobre ${r.sha.slice(0, 7)} (coste $${r.cost.toFixed(2)}, una llamada de la suscripción)`;

export function cliPrejuicio(argv, deps = {}) {
  return runCommand(argv, {
    run: (args) => {
      const r = prejuicio({ ...parseArgs(args), ...deps });
      if (r.veredicto === ANSWER.no) throw new ExitError('PREJUICIO_NO', `${humanPrejuicio(r)}\n${humanNos(r.nos)}`);
      return r;
    },
    human: humanPrejuicio,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) finish(cliPrejuicio(process.argv.slice(2)));
