// Claude Code hook that logs human interventions (scripts/lib/registro-intervenciones.mjs). Two modes, chosen by the
// first argument; the hook JSON comes on stdin:
//   permiso  PermissionRequest hook: Claude Code is about to ask Pablo for permission -> one `aviso-de-permiso` line.
//            Documented event (https://code.claude.com/docs/en/hooks, section PermissionRequest). Nothing of the tool call
//            is kept. It prints no decision, so the permission prompt is shown as usual.
//   bang     Stop and SessionEnd hooks: one `sin-clasificar` line per `!` command Pablo typed since the last look.
//            Claude Code has no hook event for `!`; the only trace is the session transcript, where a `!` is a user line
//            whose content is <bash-input>command</bash-input>. That format is NOT documented (seen in local transcripts,
//            as MenuPlan's .claude/hooks/intervenciones.mjs does): if it changes this finds nothing and says nothing.
//            The command is recognised in memory and dropped; it is never written. Not classified further on purpose:
//            without keeping the text there is nothing to classify by.
// A failure is said on stderr and exits 1 (a non-blocking error for Claude Code): the session goes on, the failure is seen.
import * as fsReal from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIN_HORA, registrarIntervencion, rutaDeRegistroIntervenciones } from './lib/registro-intervenciones.mjs';

// A `!` with a readable time older than this is not logged: it belongs to a resumed session, not to now.
const MAX_EDAD_MS = 6 * 60 * 60 * 1000;
const MAX_LECTURA = 8 * 1024 * 1024;
const SESION_OK = /^[\w-]{6,80}$/;

// The `!` commands in a piece of transcript (JSONL lines): [{ ts }]. Only the time is kept. A line that does not mention
// <bash-input> is ignored without parsing (the transcript has many); one that does and is not JSON throws.
export function bangsDe(texto) {
  const salida = [];
  for (const linea of String(texto ?? '').split('\n')) {
    if (!linea.includes('<bash-input>')) continue;
    const fila = JSON.parse(linea);
    const contenido = fila?.message?.content;
    if (fila?.type !== 'user' || fila.isSidechain || typeof contenido !== 'string') continue;
    if (/^\s*<bash-input>[\s\S]*?<\/bash-input>\s*$/.test(contenido)) salida.push({ ts: typeof fila.timestamp === 'string' ? fila.timestamp : null });
  }
  return salida;
}

// Reads the transcript from byte `desde` up to the last complete line: { texto, hasta }.
export function leerDesde(ruta, desde, fs = fsReal) {
  const fd = fs.openSync(ruta, 'r');
  try {
    const { size } = fs.fstatSync(fd);
    const ini = desde > size ? 0 : desde;
    const largo = Math.min(size - ini, MAX_LECTURA);
    const buf = Buffer.alloc(largo);
    fs.readSync(fd, buf, 0, largo, ini);
    const texto = buf.toString('utf8');
    const corte = texto.lastIndexOf('\n');
    // No newline: either a line still being written (wait) or a window inside a giant line (skip it, or the mark never advances).
    if (corte < 0) return { texto: '', hasta: largo >= MAX_LECTURA ? ini + largo : ini };
    const util = texto.slice(0, corte + 1);
    return { texto: util, hasta: ini + Buffer.byteLength(util, 'utf8') };
  } finally {
    fs.closeSync(fd);
  }
}

// Logs the new `!` of a session; returns how many lines it wrote. `entrada` is the hook JSON.
export function anotarBangs(entrada, { casa = homedir, fs = fsReal, ahora = new Date() } = {}) {
  const sesion = entrada?.session_id;
  const transcript = entrada?.transcript_path;
  if (entrada?.agent_id) return 0; // a subagent cannot receive a `!`
  if (typeof sesion !== 'string' || !SESION_OK.test(sesion)) throw new Error('hook input without a valid session_id');
  if (typeof transcript !== 'string' || !fs.existsSync(transcript)) throw new Error('hook input without a readable transcript_path');
  const marca = join(casa(), '.fabrica', 'marcas', `${sesion}.bang`);
  let desde = 0;
  if (fs.existsSync(marca)) {
    desde = Number.parseInt(fs.readFileSync(marca, 'utf8'), 10);
    if (!Number.isSafeInteger(desde) || desde < 0) throw new Error('the mark file of this session does not hold a byte offset');
  }
  const { texto, hasta } = leerDesde(transcript, desde, fs);
  // The mark is written BEFORE logging, so Stop and SessionEnd running together do not log the same `!` twice.
  fs.mkdirSync(join(casa(), '.fabrica', 'marcas'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(marca, String(hasta));
  let n = 0;
  for (const { ts } of bangsDe(texto)) {
    const cuando = ts ? new Date(ts) : null;
    const ruta = rutaDeRegistroIntervenciones(casa);
    if (!cuando || Number.isNaN(cuando.getTime())) {
      // No readable time: it cannot be told apart from an old one, so it is logged, marked, and never dropped or given a time.
      registrarIntervencion({ clase: 'sin-clasificar', origen: SIN_HORA, ruta, fs });
    } else if (ahora.getTime() - cuando.getTime() <= MAX_EDAD_MS) {
      registrarIntervencion({ clase: 'sin-clasificar', origen: 'bang', ruta, fs, reloj: () => cuando.getTime() });
    } else continue; // older than MAX_EDAD_MS: a resumed session, not now
    n++;
  }
  return n;
}

// Logs one permission prompt. The hook input is not read for content: whatever the tool call was, the line is the same.
export function anotarPermiso({ casa = homedir, fs = fsReal, reloj = Date.now } = {}) {
  registrarIntervencion({ clase: 'aviso-de-permiso', origen: 'permiso', ruta: rutaDeRegistroIntervenciones(casa), fs, reloj });
  return 1;
}

async function principal() {
  const modo = process.argv[2];
  if (modo !== 'permiso' && modo !== 'bang') throw new Error('usage: intervenciones.mjs permiso|bang (hook JSON on stdin)');
  let crudo = '';
  for await (const trozo of process.stdin) crudo += trozo;
  const entrada = JSON.parse(crudo);
  if (modo === 'permiso') anotarPermiso();
  else anotarBangs(entrada);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await principal();
  } catch (e) {
    console.error(`intervenciones: ${e.message}`);
    process.exit(1);
  }
}
