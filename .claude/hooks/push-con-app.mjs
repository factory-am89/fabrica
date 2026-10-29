// Hook PreToolUse: `git push` y `gh pr create|edit|merge` solo van envueltos en `scripts/token.mjs --`,
// que pone la identidad de la App (fabrica-constructor). Sin envoltorio usarían las credenciales de la
// máquina, que son las de Pablo (pasó en fabrica#182 y pabloam89/MenuPlan#970).
// No mira la carpeta ni el repo: vale igual en C:\dev\fabrica-*, C:\dev\MenuPlan-* o C:\dev\homenu-panel-*
// (cada repo lo registra en su `.claude/settings.json`). Lee la orden con el mismo troceador que
// carpeta-principal.mjs: un `git push` dentro de comillas, de un echo o de un heredoc no cuenta.
// `gh pr view|checks|diff|list` y el resto de gh y git pasan. Entrada (JSON por stdin): { tool_name, tool_input }.
import { fileURLToPath } from 'node:url';
import { nombreDe, ordenDeShell, saltarPrefijos, SHELLS, TERMINAL, trocear } from './carpeta-principal.mjs';

const PR_CON_ESCRITURA = new Set(['create', 'edit', 'merge']);

export const MOTIVO = 'Esa orden va con la identidad de la App, no con las credenciales de la máquina (que son las de Pablo): envuélvela así: `node scripts/token.mjs -- git push -u origin <rama>` o `node scripts/token.mjs -- gh pr create|edit|merge …` (en un repo ajeno, `FABRICA_REPO=<dueño>/<repo> node <ruta de la Fábrica>/scripts/token.mjs -- …`).';

// Quita el cuerpo de los heredocs (`<<EOF … EOF`): es texto, no órdenes.
const sinHeredocs = (s) => s.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)/g, '');

// Verbo de git tras sus opciones globales (`-C ruta`, `-c clave=valor`), o undefined.
function verboGit(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-C' || args[i] === '-c') i += 1;
    else if (!args[i].startsWith('-')) return args[i];
  }
  return undefined;
}

// Subcomando de `gh pr`, o undefined si no es `gh pr …` (salta -R/--repo y sus valores).
function subcomandoPr(args) {
  const palabras = [];
  for (let i = 0; i < args.length && palabras.length < 2; i++) {
    if (args[i] === '-R' || args[i] === '--repo') i += 1;
    else if (!args[i].startsWith('-')) palabras.push(args[i]);
  }
  return palabras[0] === 'pr' ? palabras[1] : undefined;
}

// ¿Esta orden simple (lista de palabras) es un push o un PR sin el envoltorio? Devuelve true/false.
function sinEnvoltorio(p, profundidad) {
  const i = saltarPrefijos(p);
  const base = nombreDe(p[i]);
  const args = p.slice(i + 1);
  if (base === 'git') return verboGit(args) === 'push';
  if (base === 'gh') return PR_CON_ESCRITURA.has(subcomandoPr(args));
  if (SHELLS.has(base) && profundidad < 3) {
    const anidada = ordenDeShell(args);
    if (anidada !== undefined) return hayIncumplimiento(anidada, profundidad + 1);
  }
  return false; // incluye `node …/token.mjs -- <orden>`: lo de detrás son argumentos del envoltorio
}

function hayIncumplimiento(orden, profundidad = 0) {
  let actual = [];
  let hallado = false;
  const cierra = () => {
    if (actual.length && !hallado) hallado = sinEnvoltorio(actual, profundidad);
    actual = [];
  };
  for (const t of trocear(sinHeredocs(orden))) {
    if (t.w !== undefined) actual.push(t.w);
    else cierra();
  }
  cierra();
  return hallado;
}

// Devuelve el motivo de la negativa, o null si se deja pasar.
export function decidir(entrada) {
  const { tool_name: herramienta, tool_input: datos = {} } = entrada;
  if (!TERMINAL.has(herramienta) || typeof datos.command !== 'string') return null;
  return hayIncumplimiento(datos.command) ? MOTIVO : null;
}

function negar(motivo) {
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: motivo } })}\n`);
}

function main(texto) {
  let entrada;
  try {
    entrada = JSON.parse(texto);
  } catch (e) {
    return negar(`push-con-app no entendió lo que le pasó Claude Code (${e.message}); por seguridad niega.`);
  }
  const motivo = decidir(entrada);
  if (motivo) negar(motivo);
}

async function leerTodo() {
  const trozos = [];
  for await (const t of process.stdin) trozos.push(t);
  return Buffer.concat(trozos).toString('utf8');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(await leerTodo());
