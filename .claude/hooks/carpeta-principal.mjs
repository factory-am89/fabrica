// Hook PreToolUse: la carpeta principal (C:\dev\fabrica) no se edita ni se commitea; el trabajo va
// en una carpeta por sesión (`npm run tarea -- feat/nombre`). Es la única regla de este hook.
// Entrada (JSON por stdin): { tool_name, tool_input, cwd }. Salida: un «deny» o nada.
// Es la primera barrera y mira cómo está escrita la orden; la que no depende de eso son los hooks
// de git de `.githooks/` (los activa `npm run tarea` o `npm run instalar-hooks`).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { absoluta, norm, worktrees } from '../../scripts/lib/folders.mjs';

const EDICION = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const TERMINAL = new Set(['Bash', 'PowerShell']);
// Verbos de git que mueven la rama o crean commits (`pull` solo vale con --ff-only).
const PROHIBIDOS = new Set(['commit', 'checkout', 'switch', 'merge', 'cherry-pick', 'revert', 'rebase', 'am', 'reset', 'pull']);
const CAMBIA_DE_CARPETA = new Set(['cd', 'chdir', 'set-location', 'sl', 'pushd', 'push-location']);
const VUELVE_A_ALGUNA = new Set(['popd', 'pop-location']);
const ENVOLTORIOS = new Set(['command', 'exec', 'nohup', 'time', 'builtin']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'pwsh', 'powershell', 'cmd']);

// Carpeta que no se sabe resolver (`cd $X`, `cd -`, `popd`): se trata como la principal.
export const DESCONOCIDA = '\0desconocida';

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

const esAbsoluta = (p) => /^([a-zA-Z]:|[\\/])/.test(p);
const resolver = (dir, p) => {
  if (dir === DESCONOCIDA) return esAbsoluta(p) ? path.resolve(absoluta(p)) : DESCONOCIDA;
  return /^\/[a-zA-Z](\/|$)/.test(p) ? absoluta(p) : path.resolve(absoluta(dir), p);
};

// Trocea una línea de shell (bash o PowerShell) en palabras y operadores. Respeta las comillas;
// `;`, `&`, `|`, saltos de línea, `&&` y `||` separan órdenes; `(`, `$(` y `{` abren un ámbito y
// `)` y `}` lo cierran.
function trocear(s) {
  const salida = [];
  let w = null;
  const suelta = () => {
    if (w !== null) salida.push({ w });
    w = null;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") {
      const j = s.indexOf(c, i + 1);
      const fin = j < 0 ? s.length : j;
      w = (w ?? '') + s.slice(i + 1, fin);
      i = fin;
    } else if (c === '$' && s[i + 1] === '(') {
      suelta();
      salida.push({ op: '(' });
      i += 1;
    } else if (c === '$' && s[i + 1] === '{') {
      w = `${w ?? ''}\${`;
      i += 1;
    } else if (c === '(' || c === '{') {
      suelta();
      salida.push({ op: '(' });
    } else if (c === ')' || c === '}') {
      suelta();
      salida.push({ op: ')' });
    } else if (c === ';' || c === '&' || c === '|' || c === '\n') {
      suelta();
      salida.push({ op: ';' });
    } else if (/\s/.test(c)) {
      suelta();
    } else {
      w = (w ?? '') + c;
    }
  }
  suelta();
  return salida;
}

// Nombre de un ejecutable sin ruta ni .exe y en minúsculas: «C:\Git\bin\git.exe» → «git».
const nombreDe = (w) => (w ?? '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();

// Recorre las órdenes de una línea siguiendo cd/Set-Location/pushd (con sus ámbitos de subshell),
// `git -C`, los prefijos `VAR=valor`, `env` y `command`, y las shells anidadas (`bash -c "…"`);
// devuelve la carpeta de la primera orden de git de PROHIBIDOS, o null.
export function carpetaDeCommit(orden, cwd, profundidad = 0) {
  let dir = cwd;
  const pila = [];
  let hallada = null;

  const git = (p, desde) => {
    let donde = dir;
    let i = desde;
    while (i < p.length && p[i].startsWith('-')) {
      if (p[i] === '-C') donde = resolver(donde, p[++i] ?? '.');
      else if (p[i] === '-c') i += 1;
      i += 1;
    }
    const verbo = p[i];
    if (!PROHIBIDOS.has(verbo)) return null;
    if (verbo === 'pull' && p.slice(i + 1).includes('--ff-only')) return null;
    return donde;
  };

  const simple = (p) => {
    let i = 0;
    while (i < p.length) {
      const base = nombreDe(p[i]);
      if (/^[A-Za-z_]\w*=/.test(p[i])) {
        i += 1;
      } else if (base === 'env') {
        i += 1;
        while (i < p.length && (p[i].startsWith('-') || /^[A-Za-z_]\w*=/.test(p[i]))) {
          if (p[i] === '-C' || p[i] === '--chdir') dir = resolver(dir, p[++i] ?? '.');
          else if (p[i] === '-u' || p[i] === '-S') i += 1;
          i += 1;
        }
      } else if (ENVOLTORIOS.has(base)) {
        i += 1;
        while (p[i]?.startsWith('-')) i += 1;
      } else break;
    }
    const base = nombreDe(p[i]);
    const args = p.slice(i + 1);
    if (CAMBIA_DE_CARPETA.has(base)) {
      let destino;
      for (let k = 0; k < args.length; k++) {
        if (/^-(path|literalpath)$/i.test(args[k])) destino = args[++k];
        else if (!args[k].startsWith('-') || args[k] === '-') destino ??= args[k];
      }
      dir = !destino || destino === '-' || /[$%`]/.test(destino) ? DESCONOCIDA : resolver(dir, destino);
    } else if (VUELVE_A_ALGUNA.has(base)) {
      dir = DESCONOCIDA;
    } else if (SHELLS.has(base) && profundidad < 3) {
      const k = args.findIndex((a) => /^-[a-z]*c$/.test(a) || /^-command$/i.test(a) || /^\/[ck]$/i.test(a));
      if (k >= 0 && args[k + 1] !== undefined) {
        const resto = /^-command$/i.test(args[k]) || /^\/[ck]$/i.test(args[k]);
        hallada = carpetaDeCommit(resto ? args.slice(k + 1).join(' ') : args[k + 1], dir, profundidad + 1);
      }
    } else if (base === 'git') {
      hallada = git(p, i + 1);
    }
  };

  let actual = [];
  const cierra = () => {
    if (actual.length && hallada === null) simple(actual);
    actual = [];
  };
  for (const t of trocear(orden)) {
    if (hallada !== null) break;
    if (t.w !== undefined) {
      actual.push(t.w);
    } else if (t.op === '(') {
      cierra();
      pila.push(dir);
    } else if (t.op === ')') {
      cierra();
      dir = pila.length ? pila.pop() : dir;
    } else {
      cierra();
    }
  }
  cierra();
  return hallada;
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
    if (donde === DESCONOCIDA) return `${MOTIVO} (no sé a qué carpeta va esa orden de git: un cd con variable o subshell, popd o cd -; usa una ruta literal o git -C <ruta>)`;
    return donde && enPrincipal(donde, carpetas) ? `${MOTIVO} (esa orden de git iba a la principal)` : null;
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
