// La limpieza de carpetas fusionadas, también cuando una sesión termina un turno (gancho Stop de .claude/settings.json).
// Reutiliza `limpiar` de scripts/clean.mjs (la misma regla que el arranque: PR fusionado con la punta de la rama, sin
// cambios sin guardar, ni la carpeta principal, ni la que contiene el cwd de la sesión que lo lanza).
// Stop salta tras CADA turno y limpiar consulta GitHub (1 REST de PRs + 1 ls-remote si hay identidad de escritura + 1 push
// por rama remota borrada), así que lleva dos frenos: un tope (como mucho una pasada cada TOPE_MS en este PC, apuntada en
// ~/.fabrica/limpieza-last.json) y un candado (lib/turno.mjs: si otra sesión está limpiando ahora, esta no espera ni repite).
// Sin más carpetas que la principal no hay nada que limpiar y no se llama a GitHub.
// Fallar en alto: lo que no se pudo borrar, o GitHub caído, sale por stderr con salida 1 (Claude Code lo muestra);
// una pasada limpia sin nada que decir no escribe nada, y las borradas van por stdout.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { limpiar, imprimir } from './clean.mjs';
import { worktrees } from './lib/folders.mjs';
import { tomarTurno } from './lib/turno.mjs';

// Diez minutos: un PR se fusiona en minutos y la carpeta pesa horas; más seguido solo gasta cuota de GitHub.
export const TOPE_MS = 10 * 60 * 1000;
// Cómo acaba una pasada (lista cerrada): limpia = corrió; tope = hecha hace poco; ocupada = otra la tiene; nada = solo la principal.
export const ESTADO = Object.freeze({ limpia: 'limpia', tope: 'tope', ocupada: 'ocupada', nada: 'nada' });
export const rutaDeUltima = (casa = homedir) => path.join(casa(), '.fabrica', 'limpieza-last.json');
export const rutaDeCandado = (casa = homedir) => path.join(casa(), '.fabrica', 'limpieza.lock');
// Sin cola (esperaMax 0): si otra pasada está en marcha, se omite. Sin suelo de memoria. Un candado de más de 5 min no es una pasada.
const TURNO = { minLibre: 0, esperaMax: 0, edadMax: 5 * 60 * 1000, sondeo: 500, quien: 'limpiar-al-terminar', tarea: 'the clean-up' };

// ms de la última pasada, o null si nunca hubo una. Un fichero que está y no se lee lanza (no se trata como «nunca»).
function ultimaPasada(ruta) {
  let texto;
  try { texto = readFileSync(ruta, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  const t = Date.parse(JSON.parse(texto)?.t);
  if (Number.isNaN(t)) throw new Error(`${ruta}: necesita una hora (t)`);
  return t;
}

// Devuelve { estado, salida }: estado `limpia` (corrió), `tope` (hecha hace poco), `ocupada` (otra la tiene), `nada` (solo la principal);
// `salida` es el resumen de limpiar (o null). Si limpiar lanza, la pasada se apunta igual (no se reintenta cada turno) y el error sube.
export function pasada({
  cwd = process.cwd(), reloj = Date.now, casa = homedir, limpiarFn = limpiar, turno = tomarTurno, listar = worktrees, tope = TOPE_MS,
} = {}) {
  if (listar(cwd).length < 2) return { estado: ESTADO.nada, salida: null };
  let mio;
  try {
    mio = turno({ ...TURNO, ruta: rutaDeCandado(casa) });
  } catch (e) {
    // Un candado que no se puede leer (escritura cortada) no es «otra pasada en marcha»: se dice, o la limpieza se pararía sin que nadie lo vea.
    if (e.key === 'DONE_TURN_TIMEOUT' && !/unreadable/.test(e.message)) return { estado: ESTADO.ocupada, salida: null };
    throw e;
  }
  try {
    const ruta = rutaDeUltima(casa);
    const antes = ultimaPasada(ruta);
    const ahora = reloj();
    if (antes !== null && ahora - antes < tope) return { estado: ESTADO.tope, salida: null };
    mkdirSync(path.dirname(ruta), { recursive: true });
    writeFileSync(ruta, `${JSON.stringify({ t: new Date(ahora).toISOString() })}\n`);
    return { estado: ESTADO.limpia, salida: limpiarFn({ cwd }) };
  } finally {
    mio.soltar();
  }
}

// Lo que se imprime: nada si no hubo nada que decir; stdout si solo borró; stderr y fallo si algo no se pudo.
export function informe(r) {
  const lineas = [];
  if (r.salida === null) return { codigo: 0, stdout: [], stderr: [] };
  imprimir(r.salida, (l) => lineas.push(l));
  if (r.salida.fallos > 0) return { codigo: 1, stdout: [], stderr: [`FÁBRICA AL TERMINAR: la limpieza dejó ${r.salida.fallos} cosas sin borrar:`, ...lineas] };
  return { codigo: 0, stdout: r.salida.borradas.length > 0 ? lineas : [], stderr: [] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const i = informe(pasada());
    i.stdout.forEach((l) => console.log(l));
    i.stderr.forEach((l) => console.error(l));
    process.exit(i.codigo);
  } catch (e) {
    console.error(`FÁBRICA AL TERMINAR: FALLÓ la limpieza: ${e.message}`);
    process.exit(1);
  }
}
