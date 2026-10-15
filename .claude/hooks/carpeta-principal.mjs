// Hook PreToolUse: la carpeta principal (C:\dev\fabrica) no se edita ni se commitea; el trabajo va
// en una carpeta por sesión (`npm run tarea -- feat/nombre`). Es la única regla de este hook.
// Entrada (JSON por stdin): { tool_name, tool_input, cwd }. Salida: un «deny» o nada.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { absoluta, norm, worktrees } from '../../scripts/lib/carpetas.mjs';

const EDICION = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const TERMINAL = new Set(['Bash', 'PowerShell']);
const PROHIBIDOS = new Set(['commit', 'checkout', 'switch']);

export const MOTIVO = 'La carpeta principal no se toca: una sesión, una carpeta, una rama. Crea la tuya con `npm run tarea -- feat/<nombre>` (o fix/ u ops/) y trabaja ahí.';

// ¿La ruta cae en la carpeta principal? La carpeta de trabajo más profunda que la contiene manda.
export function enPrincipal(ruta, carpetas) {
  const destino = norm(ruta);
  let mejor = -1;
  carpetas.forEach((c, i) => {
    const base = norm(c);
    const dentro = destino === base || destino.startsWith(`${base}${path.sep}`);
    if (dentro && (mejor === -1 || base.length > norm(carpetas[mejor]).length)) mejor = i;
  });
  return mejor === 0;
}

const resolver = (dir, p) => (/^\/[a-zA-Z](\/|$)/.test(p) ? absoluta(p) : path.resolve(absoluta(dir), p));

const palabras = (s) => [...s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);

// Recorre las órdenes de una línea siguiendo `cd` y `git -C`; devuelve la carpeta de la primera que
// hace commit o cambia de rama, o null.
export function carpetaDeCommit(orden, cwd) {
  let dir = cwd;
  for (const segmento of orden.split(/&&|\|\||;|\||\r?\n/)) {
    const p = palabras(segmento.trim());
    if (p[0] === 'cd' && p[1]) {
      dir = resolver(dir, p[1]);
    } else if (/(^|[\\/])git(\.exe)?$/.test(p[0] ?? '')) {
      let donde = dir;
      let i = 1;
      while (i < p.length && p[i].startsWith('-')) {
        if (p[i] === '-C') donde = resolver(donde, p[++i] ?? '.');
        else if (p[i] === '-c') i += 1;
        i += 1;
      }
      if (PROHIBIDOS.has(p[i])) return donde;
    }
  }
  return null;
}

// Devuelve el motivo de la negativa, o null si se deja pasar.
export function decidir(entrada, carpetas) {
  const { tool_name: herramienta, tool_input: datos = {}, cwd = process.cwd() } = entrada;
  if (EDICION.has(herramienta)) {
    const ruta = datos.file_path ?? datos.notebook_path;
    return ruta && enPrincipal(resolver(cwd, ruta), carpetas) ? `${MOTIVO} (no edito ${ruta})` : null;
  }
  if (TERMINAL.has(herramienta) && typeof datos.command === 'string') {
    const donde = carpetaDeCommit(datos.command, cwd);
    return donde && enPrincipal(donde, carpetas) ? `${MOTIVO} (ese git commit/checkout iba a la principal)` : null;
  }
  return null;
}

function negar(motivo) {
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: motivo } })}\n`);
}

function main(texto) {
  let entrada;
  try {
    entrada = JSON.parse(texto);
  } catch (e) {
    return negar(`carpeta-principal no entendió lo que le pasó Claude Code (${e.message}); por seguridad niega.`);
  }
  let carpetas;
  try {
    carpetas = worktrees(entrada.cwd ?? process.cwd()).map((w) => w.ruta);
  } catch (e) {
    if (/not a git repository/i.test(e.message)) return;
    return negar(`carpeta-principal no pudo mirar las carpetas de trabajo (${e.message}); por seguridad niega.`);
  }
  const motivo = decidir(entrada, carpetas);
  if (motivo) negar(motivo);
}

async function leerTodo() {
  const trozos = [];
  for await (const t of process.stdin) trozos.push(t);
  return Buffer.concat(trozos).toString('utf8');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(await leerTodo());
