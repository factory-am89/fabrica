// Scores the reviewer against the reviewer corpus (test/fixtures/golden/review/), with no model: it only READS outputs that
// someone else produced (a later chunk runs the real reviewer and writes them).
//   node scripts/golden.mjs --outputs DIR [--trials N] [--floor FILE] [--corpus DIR] [--json]
// Corpus: one folder per case with pr.diff and body.md, plus expected.json next to them:
//   { "<case>": { "author": "sonnet|opus|human", "expect": "<question id with a no>|clean" } }
// Outputs: DIR/<case>/<trial>.json for trial 1..N (N = --trials, 1 by default), each the raw text the judge reads
// ({respuestas:[{id, respuesta, prueba}]}). The reduction is `decidir` of scripts/veredicto.mjs: one reading path, the
// same one that turns the real reviewer output into a verdict.
// Floor file: { "deteccion": { "<question id>": <0..1> }, "falsosNo": <0..1> }.
// Exit 1 on anything missing, unreadable or malformed, and when the result is under the floor.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKED_BY, ID_SOURCE } from './lib/questions.mjs';
import { CASE_FILES, CLEAN, EXPECTED_FILE, GOLDEN_DIR, checkFloorShape, plain } from './lib/golden-guard.mjs';
import { ANSWER } from './lib/record.mjs';
import { cargarPreguntas, decidir } from './veredicto.mjs';

const RAIZ = path.resolve(import.meta.dirname, '..');
export const CORPUS = path.join(RAIZ, ...GOLDEN_DIR.split('/'));
export const STANDARD = 'standards/code.md';
export const AUTHORS = ['sonnet', 'opus', 'human'];
export { CLEAN };
export const MIN_CASES_PER_CELL = 5;
// The paths of the judge: a change of any of them makes the last pass of the corpus out of date. They were the `paths` of the `push` of
// golden.yml until chunk 25 removed it (git show 4f388e1:.github/workflows/golden.yml); audit --data counts the commits that touched them since the last good pass.
export const JUDGE_PATHS = Object.freeze(['.claude/agents/revisor.md', 'standards/**', '.github/workflows/revisor.yml', 'scripts/veredicto.mjs']);
// decidir also checks that the judged commit is the PR head; here there is no PR, so both are the same fixed value.
const CTX = { sha: 'corpus', cabeza: 'corpus' };

const rate = (n, d) => (d === 0 ? null : n / d);
const readJson = (file, what) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${what}: cannot read ${file}`, { cause: e });
  }
};

// Reads the corpus and checks it against the standard's reviewer questions. Throws on the first malformed thing.
export function loadCorpus(dir, preguntas) {
  const expected = readJson(path.join(dir, EXPECTED_FILE), 'corpus');
  if (!plain(expected)) throw new Error('corpus: expected.json must be an object');
  const folders = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const ids = Object.keys(expected).sort();
  if (JSON.stringify(folders) !== JSON.stringify(ids)) throw new Error(`corpus: case folders (${folders.join(', ')}) and expectations (${ids.join(', ')}) differ`);
  const reviewer = new Set(preguntas.filter((q) => q.quien === CHECKED_BY.reviewer).map((q) => q.id));
  return ids.map((id) => {
    const e = expected[id];
    if (!plain(e) || Object.keys(e).sort().join() !== 'author,expect') throw new Error(`corpus: ${id} must have exactly author and expect`);
    if (!AUTHORS.includes(e.author)) throw new Error(`corpus: ${id} has an author outside ${AUTHORS.join(', ')}`);
    if (e.expect !== CLEAN && !reviewer.has(e.expect)) throw new Error(`corpus: ${id} expects ${e.expect}, which is not a reviewer question of the standard`);
    for (const f of CASE_FILES) {
      const file = path.join(dir, id, f);
      if (!existsSync(file) || readFileSync(file, 'utf8').trim() === '') throw new Error(`corpus: ${id}/${f} is missing or empty`);
    }
    return { id, author: e.author, expect: e.expect };
  });
}

// DIR/<case>/<trial>.json -> { <case>: [text, ...] }. Throws listing every missing file: a missing output is never a "sí".
export function loadOutputs(dir, cases, trials) {
  const missing = [];
  const outputs = {};
  for (const c of cases) {
    outputs[c.id] = [];
    for (let t = 1; t <= trials; t += 1) {
      const file = path.join(dir, c.id, `${t}.json`);
      if (existsSync(file)) outputs[c.id].push(readFileSync(file, 'utf8'));
      else missing.push(`${c.id}/${t}.json`);
    }
  }
  if (missing.length) throw new Error(`missing outputs (${missing.length}): ${missing.join(', ')}`);
  return outputs;
}

// One output -> { <question id>: 'sí'|'no'|'no aplica' } through decidir. Throws when the text is unreadable or when decidir finds
// anything wrong other than a plain «Cn: no» (missing, repeated, unknown or invalid answer, a sí without proof): the real judge
// would turn those into a verdict no, so a measurement taken from them would be false. Nothing is read as «no no».
const PLAIN_NO = new RegExp(`^${ID_SOURCE}: ${ANSWER.no}$`);
export function answersOf(text, preguntas, label) {
  const v = decidir(text, preguntas, CTX);
  if (v.respuestas === null) throw new Error(`unreadable output: ${label}`);
  const rejected = v.fallos.filter((f) => !PLAIN_NO.test(f));
  if (rejected.length) throw new Error(`rejected output: ${label} (${rejected.join('; ')})`);
  return v.respuestas.answers;
}

const majorityNo = (trials, id) => trials.filter((a) => a[id] === ANSWER.no).length * 2 > trials.length;
const cell = (cazados, malos) => ({ malos, cazados, tasa: rate(cazados, malos), concluyente: malos >= MIN_CASES_PER_CELL });

// Detection per question, false "no" on clean cases and detection per author, from the cases and their trials' answers.
export function score(cases, answers) {
  const deteccion = {};
  const porAutor = {};
  let limpios = 0;
  let falsos = 0;
  for (const c of cases) {
    const trials = answers[c.id];
    if (c.expect === CLEAN) {
      limpios += 1;
      if (Object.keys(trials[0]).some((id) => majorityNo(trials, id))) falsos += 1;
      continue;
    }
    const cazado = majorityNo(trials, c.expect) ? 1 : 0;
    const q = (deteccion[c.expect] ??= { malos: 0, cazados: 0 });
    q.malos += 1;
    q.cazados += cazado;
    const a = (porAutor[c.author] ??= { malos: 0, cazados: 0 });
    a.malos += 1;
    a.cazados += cazado;
  }
  return {
    casos: cases.length,
    deteccion: Object.fromEntries(Object.entries(deteccion).map(([id, q]) => [id, cell(q.cazados, q.malos)])),
    falsosNo: { limpios, falsos, tasa: rate(falsos, limpios) },
    porAutor: Object.fromEntries(Object.entries(porAutor).map(([au, q]) => [au, cell(q.cazados, q.malos)])),
  };
}

// Floor -> list of faults of `informe` against it (empty when it holds). Throws on a malformed floor.
export function belowFloor(informe, floor) {
  checkFloorShape(floor);
  const faults = [];
  for (const [id, min] of Object.entries(floor.deteccion)) {
    const d = informe.deteccion[id];
    if (!d) throw new Error(`floor: ${id} has no case in the corpus`);
    if (d.tasa < min) faults.push(`${id}: detection ${d.tasa} under the floor ${min}`);
  }
  if (informe.falsosNo.tasa === null) throw new Error('floor: the corpus has no clean case to measure false no');
  if (informe.falsosNo.tasa > floor.falsosNo) faults.push(`false no ${informe.falsosNo.tasa} over the floor ${floor.falsosNo}`);
  return faults;
}

const pct = (t) => (t === null ? 'n/a' : `${Math.round(t * 100)}%`);
const verdictOf = (c) => `${c.cazados}/${c.malos} (${pct(c.tasa)})${c.concluyente ? '' : ', no concluyente'}`;

export function format(informe, faults) {
  return [
    `cases: ${informe.casos}`,
    ...Object.entries(informe.deteccion).map(([id, c]) => `detection ${id}: ${verdictOf(c)}`),
    `false no on clean cases: ${informe.falsosNo.falsos}/${informe.falsosNo.limpios} (${pct(informe.falsosNo.tasa)})`,
    ...Object.entries(informe.porAutor).map(([au, c]) => `detection by author ${au}: ${verdictOf(c)}`),
    ...faults.map((f) => `under the floor: ${f}`),
  ].join('\n');
}

// Everything from files to the report; the only entry point the command and the tests share.
export function run({ outputs, trials = 1, floor = null, corpus = CORPUS, raiz = RAIZ }) {
  const preguntas = cargarPreguntas(STANDARD, raiz);
  const cases = loadCorpus(corpus, preguntas);
  const texts = loadOutputs(outputs, cases, trials);
  const answers = Object.fromEntries(cases.map((c) => [c.id, texts[c.id].map((t, i) => answersOf(t, preguntas, `${c.id}/${i + 1}.json`))]));
  const informe = score(cases, answers);
  const faults = floor ? belowFloor(informe, readJson(floor, 'floor')) : [];
  return { informe, faults };
}

function parseArgs(argv) {
  const opts = { json: false };
  const known = { '--outputs': 'outputs', '--trials': 'trials', '--floor': 'floor', '--corpus': 'corpus' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') opts.json = true;
    else if (known[argv[i]] && argv[i + 1] !== undefined) opts[known[argv[i]]] = argv[++i];
    else throw new Error(`unknown or incomplete argument: ${argv[i]}`);
  }
  if (!opts.outputs) throw new Error('--outputs DIR is required');
  if (opts.trials !== undefined) {
    if (!/^[1-9]\d*$/.test(opts.trials)) throw new Error('--trials must be a positive integer');
    opts.trials = Number(opts.trials);
  }
  return opts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const { informe, faults } = run(opts);
    console.log(opts.json ? JSON.stringify({ ...informe, bajoSuelo: faults }, null, 2) : format(informe, faults));
    if (faults.length) process.exit(1);
  } catch (e) {
    console.error(`golden: ${e.message}`);
    process.exit(1);
  }
}
