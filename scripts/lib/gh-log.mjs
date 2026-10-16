// Log of GitHub CLI calls: one JSON line per `gh` run through token.mjs in the file of rutaDeRegistroGh (below), so the
// quota spent (REST and GraphQL are separate quotas) can be counted instead of guessed.
// A line holds: t (ISO time), caller (script name only), api (APIS), result (RESULTADOS). Nothing else:
// no arguments, no paths, no repo or issue names, no tokens. The vocabularies below are the only place that lists them.
import * as fsReal from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { anexarLinea, FORMA_NOMBRE } from './op-log.mjs';

export const APIS = ['rest', 'graphql', 'unknown'];
export const RESULTADOS = ['ok', 'limited', 'error'];
export const CAMPOS = ['t', 'caller', 'api', 'result'];

export const rutaDeRegistroGh = (casa = homedir) => join(casa(), '.fabrica', 'gh-calls.jsonl');

// Closed table: gh subcommand -> quota it spends. `gh api` is classified by its endpoint (below). Anything else is unknown.
// Measured in MenuPlan, not verified here: almost all of issue/pr/label go through GraphQL.
export const SUBCOMANDOS = { run: 'rest', workflow: 'rest', secret: 'rest', issue: 'graphql', pr: 'graphql', label: 'graphql' };

// `gh api` flags whose next word is their value, so it is not mistaken for the endpoint.
const CON_VALOR = new Set(['-X', '--method', '-H', '--header', '-f', '--raw-field', '-F', '--field', '-q', '--jq', '-t', '--template', '--input', '--hostname', '--cache', '-R', '--repo']);

// First word that is not a flag (nor the value of a flag that takes one).
function primerPosicional(args) {
  for (let i = 0; i < args.length; i++) {
    if (CON_VALOR.has(args[i])) i++;
    else if (!args[i].startsWith('-')) return { palabra: args[i], resto: args.slice(i + 1) };
  }
  return null;
}

// The quota a gh call spends, from its arguments (without the leading `gh`): 'rest' | 'graphql' | 'unknown'.
export function clasificarApi(args) {
  const sub = primerPosicional(args);
  if (!sub) return 'unknown';
  if (sub.palabra === 'api') {
    const destino = primerPosicional(sub.resto)?.palabra?.replace(/^\//, '');
    if (destino === 'graphql') return 'graphql';
    return destino?.startsWith('repos/') ? 'rest' : 'unknown';
  }
  return Object.hasOwn(SUBCOMANDOS, sub.palabra) ? SUBCOMANDOS[sub.palabra] : 'unknown';
}

const LIMITADO = /rate limit|RATE_LIMIT/i;

// How a gh call ended: its exit status and what it wrote to stderr. The text is only tested, never kept.
export function resultadoDe(status, stderr = '') {
  if (status === 0) return 'ok';
  return LIMITADO.test(stderr) ? 'limited' : 'error';
}

// Appends one line. Throws if a field is outside the vocabulary or the disk refuses: the caller decides what to say.
export function registrarLlamada({ caller, api, resultado, ruta = rutaDeRegistroGh(), fs = fsReal, reloj = Date.now }) {
  if (!FORMA_NOMBRE.test(String(caller)) || !APIS.includes(api) || !RESULTADOS.includes(resultado)) {
    throw new Error('gh log: field outside the vocabulary (a script name, an api and a result are expected, nothing else)');
  }
  anexarLinea(ruta, { t: new Date(reloj()).toISOString(), caller, api, result: resultado }, fs);
}

// Calls per api and per clock hour (UTC): { total: {rest, graphql, unknown}, limited, porHora: { '2026-10-16T10': {...} } }.
// No file means no calls. A line that cannot be read throws (a count that skips lines would be a wrong number).
// GitHub's window is the hour that ends at its `resetAt`, not the clock hour: this is an approximation for comparing.
export function contarLlamadas({ ruta = rutaDeRegistroGh(), fs = fsReal } = {}) {
  let crudo;
  try {
    crudo = fs.readFileSync(ruta, 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') return { total: Object.fromEntries(APIS.map((a) => [a, 0])), limited: 0, porHora: {} };
    throw e;
  }
  const vacio = () => Object.fromEntries(APIS.map((a) => [a, 0]));
  const cuentas = { total: vacio(), limited: 0, porHora: {} };
  crudo.split('\n').forEach((linea, i) => {
    if (!linea) return;
    let d;
    try {
      d = JSON.parse(linea);
    } catch (e) {
      throw new Error(`gh log: line ${i + 1} is not JSON`, { cause: e });
    }
    if (!APIS.includes(d?.api) || !RESULTADOS.includes(d.result) || Number.isNaN(Date.parse(d.t))) throw new Error(`gh log: line ${i + 1} has the wrong shape`);
    const hora = new Date(d.t).toISOString().slice(0, 13);
    (cuentas.porHora[hora] ??= vacio())[d.api]++;
    cuentas.total[d.api]++;
    if (d.result === 'limited') cuentas.limited++;
  });
  return cuentas;
}
