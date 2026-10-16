// Runs the real reviewer (`claude -p`) on the reviewer corpus, locally: no workflow, no new secret (it uses the session's own login).
//   node scripts/golden-run.mjs [--trials N] [--ref GIT_REF] [--out DIR] [--workflow FILE] [--corpus DIR]
// Prompt, model, max turns, allowed tools and schema are READ from .github/workflows/revisor.yml (step `claude`) with js-yaml:
// that file is their only source. The only changes made to the prompt are the PR number, the diff path and the sentence that
// sends the reviewer to `gh pr view` (there is no PR here: it points to body.md instead); Bash tools are dropped for the same reason.
// Each call gets its own temp workspace: .fabrica/ = `git archive` of --ref (HEAD by default) WITHOUT test/fixtures/golden/ (the
// reviewer must not read the expectations), plus pr.diff and body.md of the case. At most MAX_CALLS calls per pass.
// Outputs go to DIR/<case>/<trial>.json (default: a folder of its own under the OS temp, kept), then scripts/golden.mjs scores
// them (no floor) and the report adds the variance: how many cases get an unstable verdict across the trials.
// GOLDEN_CLAUDE_BIN replaces the claude binary (tests: test/fixtures/claude-falso.mjs).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { CORPUS, STANDARD, answersOf, format, loadCorpus, loadOutputs, score } from './golden.mjs';
import { cargarPreguntas } from './veredicto.mjs';

const RAIZ = path.resolve(import.meta.dirname, '..');
export const MAX_CALLS = 27;
export const DEFAULT_TRIALS = 3;
const WORKFLOW = path.join(RAIZ, '.github', 'workflows', 'revisor.yml');
const EXCLUDED = 'test/fixtures/golden';
const FAKE_PR = '0';
const FAKE_REPO = 'corpus';
const GH_SENTENCE = 'el resto del PR, con `gh pr view`';
const QUOTES = ['\'', '"'];

// Shell-like split of the claude_args string: whitespace separates, '...' and "..." group (no escapes in the file).
export function splitArgs(text) {
  const tokens = [];
  let cur = null;
  let quote = null;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (QUOTES.includes(ch)) {
      quote = ch;
      cur ??= '';
    } else if (/\s/.test(ch)) {
      if (cur !== null) tokens.push(cur);
      cur = null;
    } else cur = (cur ?? '') + ch;
  }
  if (quote) throw new Error('claude_args: unclosed quote');
  if (cur !== null) tokens.push(cur);
  return tokens;
}

// "Read,Grep,Bash(gh pr view:*)" -> ["Read", "Grep", "Bash(gh pr view:*)"] (commas inside parentheses stay).
function splitTools(text) {
  const tools = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      tools.push(cur);
      cur = '';
    } else cur += ch;
  }
  return [...tools, cur].filter(Boolean);
}

// revisor.yml -> { prompt, model, maxTurns, schema, tools }. Throws on anything missing: nothing falls back to a default.
export function readReviewer(file = WORKFLOW) {
  const wf = yaml.load(readFileSync(file, 'utf8'));
  const step = Object.values(wf?.jobs ?? {}).flatMap((j) => j.steps ?? []).find((s) => s.id === 'claude');
  if (!step?.with?.prompt || !step.with.claude_args) throw new Error(`${file}: no step "claude" with prompt and claude_args`);
  const args = splitArgs(step.with.claude_args);
  const value = (flag) => {
    const i = args.indexOf(flag);
    if (i === -1 || args[i + 1] === undefined) throw new Error(`${file}: claude_args has no ${flag}`);
    return args[i + 1];
  };
  const schema = value('--json-schema');
  JSON.parse(schema);
  return { prompt: step.with.prompt, model: value('--model'), maxTurns: value('--max-turns'), schema, tools: splitTools(value('--allowedTools')) };
}

// The workflow's prompt for one workspace. Throws if a placeholder or the gh sentence is not what is expected.
export function promptFor(prompt, workspace) {
  if (!prompt.includes(GH_SENTENCE)) throw new Error(`the prompt of revisor.yml no longer contains "${GH_SENTENCE}": update golden-run.mjs`);
  const text = prompt
    .replace(GH_SENTENCE, `el título y la descripción del PR, en ${path.join(workspace, 'body.md')}`)
    .replaceAll('${{ github.event.pull_request.number }}', FAKE_PR)
    .replaceAll('${{ github.repository }}', FAKE_REPO)
    .replaceAll('${{ runner.temp }}/pr.diff', path.join(workspace, 'pr.diff'));
  const left = text.match(/\$\{\{[^}]*\}\}/);
  if (left) throw new Error(`the prompt of revisor.yml has a placeholder this runner does not know: ${left[0]}`);
  return text;
}

// The claude to run: GOLDEN_CLAUDE_BIN (a .mjs runs with node), else `claude`; on Windows the npm shim is a .cmd that spawn
// cannot run without a shell, so the native claude.exe of the same package is used.
export function resolveClaude(env = process.env) {
  if (env.GOLDEN_CLAUDE_BIN) return env.GOLDEN_CLAUDE_BIN.endsWith('.mjs') ? { cmd: process.execPath, pre: [env.GOLDEN_CLAUDE_BIN] } : { cmd: env.GOLDEN_CLAUDE_BIN, pre: [] };
  if (process.platform === 'win32') {
    for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter)) {
      const exe = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
      if (dir && existsSync(path.join(dir, 'claude.cmd')) && existsSync(exe)) return { cmd: exe, pre: [] };
    }
    throw new Error('claude.exe not found next to claude.cmd on PATH; set GOLDEN_CLAUDE_BIN');
  }
  return { cmd: 'claude', pre: [] };
}

// The commit under test without the corpus, extracted once; returns the folder. Relative paths to tar: GNU tar reads "C:" as a host.
function exportJudge(ref, dir) {
  const tar = path.join(dir, 'judge.tar');
  const a = spawnSync('git', ['archive', '--format=tar', '-o', tar, ref, '--', '.', `:(exclude)${EXCLUDED}`], { cwd: RAIZ, encoding: 'utf8' });
  if (a.status !== 0) throw new Error(`git archive ${ref} failed: ${a.stderr}`);
  const tree = path.join(dir, 'judge');
  mkdirSync(tree);
  const x = spawnSync('tar', ['-xf', 'judge.tar', '-C', 'judge'], { cwd: dir, encoding: 'utf8' });
  if (x.status !== 0) throw new Error(`tar failed: ${x.stderr}`);
  rmSync(tar);
  return tree;
}

// One call: returns { text (the structured output), cost }. Throws on any failure of claude or of its output.
function callClaude({ claude, reviewer, workspace }) {
  const tools = reviewer.tools.filter((t) => !t.startsWith('Bash'));
  const args = [...claude.pre, '-p', '--output-format', 'json', '--no-session-persistence', '--model', reviewer.model, '--max-turns', reviewer.maxTurns, '--allowedTools', tools.join(','), '--json-schema', reviewer.schema];
  const r = spawnSync(claude.cmd, args, { cwd: workspace, input: promptFor(reviewer.prompt, workspace), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error('cannot run claude', { cause: r.error });
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch (e) {
    throw new Error(`claude failed (exit ${r.status}, unreadable output): ${r.stderr.slice(0, 300)}`, { cause: e });
  }
  if (r.status !== 0 || out.is_error || out.structured_output === undefined) {
    throw new Error(`claude failed (exit ${r.status}, is_error ${out.is_error}, ${out.structured_output === undefined ? 'no structured_output' : 'structured_output present'})`);
  }
  if (typeof out.total_cost_usd !== 'number') throw new Error('claude did not report total_cost_usd');
  return { text: JSON.stringify(out.structured_output), cost: out.total_cost_usd };
}

// Variance: cases whose verdict (no if any answer is no) changes between trials, and the questions whose answer changes.
export function variance(cases, answers) {
  const inestables = [];
  const preguntas = {};
  const veredicto = (a) => (Object.values(a).includes('no') ? 'no' : 'sí');
  for (const c of cases) {
    const trials = answers[c.id];
    if (new Set(trials.map(veredicto)).size > 1) inestables.push(c.id);
    for (const id of Object.keys(trials[0])) if (new Set(trials.map((a) => a[id])).size > 1) (preguntas[id] ??= []).push(c.id);
  }
  return { casos: cases.length, inestables, preguntas };
}

export function formatVariance(v, trials) {
  const qs = Object.entries(v.preguntas).map(([id, c]) => `${id} (${c.length} cases)`);
  return [
    `trials per case: ${trials}`,
    `unstable verdict: ${v.inestables.length}/${v.casos} cases${v.inestables.length ? ` (${v.inestables.join(', ')})` : ''}`,
    `unstable questions: ${qs.length ? qs.join(', ') : 'none'}`,
  ].join('\n');
}

// One call, in its own workspace that is always removed.
function oneCall({ root, judge, corpus, c, t, claude, reviewer }) {
  const workspace = path.join(root, `w-${c.id}-${t}`);
  try {
    cpSync(judge, path.join(workspace, '.fabrica'), { recursive: true });
    for (const f of ['pr.diff', 'body.md']) cpSync(path.join(corpus, c.id, f), path.join(workspace, f));
    return callClaude({ claude, reviewer, workspace });
  } catch (e) {
    throw new Error(`${c.id}/${t}: ${e.message}`, { cause: e });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

export function runPass({ trials = DEFAULT_TRIALS, ref = 'HEAD', out, workflow = WORKFLOW, corpus = CORPUS, log = console.log }) {
  const preguntas = cargarPreguntas(STANDARD, RAIZ);
  const cases = loadCorpus(corpus, preguntas);
  const calls = cases.length * trials;
  if (calls > MAX_CALLS) throw new Error(`${calls} calls (${cases.length} cases x ${trials} trials) is over the limit of ${MAX_CALLS}`);
  const reviewer = readReviewer(workflow);
  const claude = resolveClaude();
  const outputs = out ?? mkdtempSync(path.join(tmpdir(), 'fabrica-golden-outputs-'));
  const root = mkdtempSync(path.join(tmpdir(), 'fabrica-golden-run-'));
  log(`${calls} calls (${cases.length} cases x ${trials} trials), model ${reviewer.model}, max ${MAX_CALLS}; outputs in ${outputs}`);
  try {
    const judge = exportJudge(ref, root);
    let total = 0;
    for (const c of cases) {
      mkdirSync(path.join(outputs, c.id), { recursive: true });
      for (let t = 1; t <= trials; t += 1) {
        const { text, cost } = oneCall({ root, judge, corpus, c, t, claude, reviewer });
        writeFileSync(path.join(outputs, c.id, `${t}.json`), text);
        total += cost;
        log(`${c.id}/${t}: cost $${cost.toFixed(2)}`);
      }
    }
    log(`total cost: $${total.toFixed(2)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const texts = loadOutputs(outputs, cases, trials);
  const answers = Object.fromEntries(cases.map((c) => [c.id, texts[c.id].map((x, i) => answersOf(x, preguntas, `${c.id}/${i + 1}.json`))]));
  return `${format(score(cases, answers), [])}\n${formatVariance(variance(cases, answers), trials)}`;
}

function parseArgs(argv) {
  const opts = {};
  const known = { '--trials': 'trials', '--ref': 'ref', '--out': 'out', '--workflow': 'workflow', '--corpus': 'corpus' };
  for (let i = 0; i < argv.length; i += 1) {
    if (known[argv[i]] && argv[i + 1] !== undefined) opts[known[argv[i]]] = argv[++i];
    else throw new Error(`unknown or incomplete argument: ${argv[i]}`);
  }
  if (opts.trials !== undefined) {
    if (!/^[1-9]\d*$/.test(opts.trials)) throw new Error('--trials must be a positive integer');
    opts.trials = Number(opts.trials);
  }
  return opts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(runPass(parseArgs(process.argv.slice(2))));
  } catch (e) {
    console.error(`golden-run: ${e.message}`);
    process.exit(1);
  }
}
