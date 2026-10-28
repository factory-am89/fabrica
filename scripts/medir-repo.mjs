// Mide, en local, cuántos de los últimos PR fusionados de un repo público recibirían «no» del juez de la Fábrica.
//   node scripts/medir-repo.mjs --repo dueño/nombre [--limit 20] [--trials 1] [--ref GIT_REF] [--out DIR]
// Lee los PR por la API pública (identidad `ninguna`: sin credencial, lib/gh-public.mjs), arma un corpus (pr-<n>/pr.diff y body.md) y llama a
// golden-run.mjs en fase `collect` (mismo prompt y modelo que revisor.yml; gasta la suscripción de la sesión, no API de pago).
// No corre en CI ni toca el repo medido. No reproduce el checkout de la base que tiene el juez de CI: el espacio de trabajo solo trae
// .fabrica/, el diff y el cuerpo. Un PR que no se puede leer, o una salida del juez ilegible, es un error: nada se cuenta como «sí».
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPass } from './golden-run.mjs';
import { consultar } from './lib/gh-public.mjs';
import { CASE_FILE } from './lib/golden-guard.mjs';
import { ANSWER } from './lib/record.mjs';
import { STANDARD, answersOf } from './golden.mjs';
import { cargarPreguntas } from './veredicto.mjs';

export const DEFAULT_LIMIT = 20;
const PAGE = 100;
const MAX_PAGES = 5;
const REPO_FORMA = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// Los `limit` PR fusionados más recientes (por fecha de fusión). Pagina por creación hasta juntar `limit` fusionados: un PR viejo
// fusionado tarde puede quedar fuera de la ventana (se mira como mucho MAX_PAGES x PAGE PR cerrados).
export async function ultimosFusionados(repo, limit, fetchFn = fetch) {
  if (!REPO_FORMA.test(repo)) throw new Error(`--repo debe ser dueño/nombre, no «${repo}»`);
  const fusionados = [];
  for (let page = 1; page <= MAX_PAGES && fusionados.length < limit; page += 1) {
    const lista = JSON.parse(await consultar(`repos/${repo}/pulls?state=closed&sort=created&direction=desc&per_page=${PAGE}&page=${page}`, fetchFn));
    if (!Array.isArray(lista)) throw new Error('la lista de PR no es una lista');
    fusionados.push(...lista.filter((p) => p.merged_at));
    if (lista.length < PAGE) break;
  }
  if (fusionados.length < limit) throw new Error(`solo hay ${fusionados.length} PR fusionados al alcance, no ${limit}`);
  return fusionados.sort((a, b) => (a.merged_at < b.merged_at ? 1 : -1)).slice(0, limit).map((p) => ({ numero: p.number, titulo: p.title ?? '', cuerpo: p.body ?? '' }));
}

// El diff del PR (la misma API, otro Accept). Sin credencial; falla en alto con cualquier estado que no sea 200.
export async function diffDe(repo, numero, fetchFn = fetch) {
  const res = await fetchFn(`https://api.github.com/repos/${repo}/pulls/${numero}`, {
    headers: { accept: 'application/vnd.github.diff', 'x-github-api-version': '2022-11-28', 'user-agent': 'fabrica-medir-repo' },
  });
  if (!res.ok) throw new Error(`GET diff de ${repo}#${numero} → ${res.status}${res.status === 403 || res.status === 429 ? ' (¿límite de consultas sin credencial?)' : ''}`);
  const texto = await res.text();
  if (texto.trim() === '') throw new Error(`el diff de ${repo}#${numero} está vacío`);
  return texto;
}

// Escribe el corpus (una carpeta pr-<n> por PR) en `dir`. Mismo formato que lee golden-run.mjs.
export async function armarCorpus(repo, prs, dir, fetchFn = fetch) {
  for (const pr of prs) {
    const caso = path.join(dir, `pr-${pr.numero}`);
    mkdirSync(caso, { recursive: true });
    writeFileSync(path.join(caso, CASE_FILE.diff), await diffDe(repo, pr.numero, fetchFn));
    // El cuerpo vacío no vale para golden-run: el título va siempre delante, como lo vería `gh pr view`.
    writeFileSync(path.join(caso, CASE_FILE.body), `# ${pr.titulo}\n\n${pr.cuerpo}\n`);
  }
}

// DIR/<caso>/<intento>.json -> { casos: [{id, no: [ids]}], conNo, preguntas: {id: n} }. Un PR recibe «no» si algún intento tiene algún «no».
export function resumir(outputs, preguntas) {
  const casos = readdirSync(outputs, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
  if (casos.length === 0) throw new Error(`ningún caso en ${outputs}: no hay cifra que dar`);
  const porPregunta = {};
  const lista = casos.map((id) => {
    const nos = new Set();
    for (const f of readdirSync(path.join(outputs, id)).filter((x) => x.endsWith('.json'))) {
      const respuestas = answersOf(readFileSync(path.join(outputs, id, f), 'utf8'), preguntas, `${id}/${f}`);
      for (const [q, r] of Object.entries(respuestas)) if (r === ANSWER.no) nos.add(q);
    }
    for (const q of nos) porPregunta[q] = (porPregunta[q] ?? 0) + 1;
    return { id, no: [...nos].sort() };
  });
  return { casos: lista, conNo: lista.filter((c) => c.no.length > 0).length, preguntas: porPregunta };
}

export function formatear(r, repo) {
  const lineas = r.casos.map((c) => `${repo}#${c.id.slice(3)}: ${c.no.length ? `no (${c.no.join(', ')})` : 'sí'}`);
  const qs = Object.entries(r.preguntas).sort().map(([q, n]) => `${q} (${n} PR)`);
  return [...lineas, `${r.conNo} de ${r.casos.length} PR recibirían «no»`, `preguntas con «no»: ${qs.length ? qs.join(', ') : 'ninguna'}`].join('\n');
}

export async function medir({ repo, limit = DEFAULT_LIMIT, trials = 1, ref = 'HEAD', out, fetchFn = fetch, log = console.log }) {
  const prs = await ultimosFusionados(repo, limit, fetchFn);
  const base = out ?? mkdtempSync(path.join(tmpdir(), 'fabrica-medir-repo-'));
  const corpus = path.join(base, 'corpus');
  const outputs = path.join(base, 'outputs');
  mkdirSync(corpus, { recursive: true });
  await armarCorpus(repo, prs, corpus, fetchFn);
  runPass({ trials, ref, out: outputs, corpus, phase: 'collect', log });
  const informe = formatear(resumir(outputs, cargarPreguntas(STANDARD)), repo);
  return `${informe}\nsalidas del juez en ${outputs}`;
}

function parseArgs(argv) {
  const known = { '--repo': 'repo', '--limit': 'limit', '--trials': 'trials', '--ref': 'ref', '--out': 'out' };
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (known[argv[i]] && argv[i + 1] !== undefined) opts[known[argv[i]]] = argv[++i];
    else throw new Error(`argumento desconocido o incompleto: ${argv[i]}`);
  }
  if (!opts.repo) throw new Error('falta --repo dueño/nombre');
  for (const k of ['limit', 'trials']) {
    if (opts[k] === undefined) continue;
    if (!/^[1-9]\d*$/.test(opts[k])) throw new Error(`--${k} debe ser un entero positivo`);
    opts[k] = Number(opts[k]);
  }
  return opts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(await medir(parseArgs(process.argv.slice(2))));
  } catch (e) {
    console.error(`medir-repo: ${e.message}`);
    process.exit(1);
  }
}
