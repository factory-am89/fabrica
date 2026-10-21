// Lo que se hace al arrancar una sesión: .claude/settings.json lanza solo este script (SessionStart).
// Un paso nuevo se añade a PASOS, no a settings.json. Un paso que falla se dice y no impide los demás.
//
// Siempre sale con 0 y todo va a stdout: en SessionStart, Claude Code añade el stdout como contexto que Claude ve
// y puede usar (https://code.claude.com/docs/en/hooks); con otra salida solo habría un aviso con la 1.ª línea de stderr.
// Si un paso falla, la primera línea lo dice sin ambigüedad y luego va el detalle: la sesión debe enterarse.
import { fileURLToPath } from 'node:url';
import { limpiar, imprimir } from './clean.mjs';
import { pasoAlDia } from './pull-main.mjs';
import { pasoHora } from './madrid-time.mjs';
import { pasoSesiones } from './sesiones.mjs';
import { pasoTls } from './sin-emsign.mjs';
import { ExitError } from './lib/exit.mjs';
import { pasoPeriodico } from './lib/periodic.mjs';

export const pasoLimpiar = (limpiarFn = limpiar) => ({
  nombre: 'limpiar',
  ejecutar: (escribir) => {
    const s = limpiarFn();
    imprimir(s, escribir);
    if (s.fallos > 0) throw new Error(`${s.fallos} cosas sin borrar (arriba)`);
  },
});

// al-dia primero: trae a la principal la ficha .fabrica.json (y lo nuevo) antes de que limpiar la lea.
// periodico (audit local, higiene y deuda; lib/periodic.mjs) corre solo al abrir sesión: lo autorizó Pablo (decisión A1 del plan trabajar-solos).
// tls: que Node no confíe en las raíces emSign (scripts/sin-emsign.mjs); sin red, solo mira este proceso.
export const PASOS = [pasoAlDia(), pasoLimpiar(), pasoSesiones(), pasoPeriodico(), pasoTls(), pasoHora()];

export const SOLO = '--solo';
const SOLO_ARGS = 2; // --solo y el nombre del paso

// argv (sin node ni el script) -> { solo: nombre de paso | null }. `--solo <paso>` corre ese paso y ningún otro (para probarlo por la
// entrada real sin tocar la carpeta principal con al-dia ni limpiar). Un argumento que no es eso, o un paso que no existe, es un error de uso.
export function leerArgumentos(argv, pasos = PASOS) {
  if (argv.length === 0) return { solo: null };
  if (argv[0] !== SOLO || argv.length !== SOLO_ARGS) throw new ExitError('USAGE', `uso: al-arrancar.mjs [${SOLO} <paso>]; recibí ${JSON.stringify(argv)}`);
  if (!pasos.some((p) => p.nombre === argv[1])) throw new ExitError('USAGE', `${SOLO}: no existe el paso «${argv[1]}»; los pasos son ${pasos.map((p) => p.nombre).join(', ')}`);
  return { solo: argv[1] };
}

// Devuelve cuántos pasos fallaron. Los titulares de fallo van primero y luego el informe de cada paso.
// `entrada` es el JSON que Claude Code da al gancho (session_id, cwd...); cada paso lo recibe como 2.º argumento.
export function arrancar(pasos = PASOS, escribir = console.log, entrada = null) {
  const titulares = [];
  const informe = [];
  for (const paso of pasos) {
    const lineas = [];
    try {
      paso.ejecutar((l) => lineas.push(l), entrada);
    } catch (e) {
      titulares.push(`FÁBRICA AL ARRANCAR: FALLÓ el paso «${paso.nombre}»: ${e.message}. Díselo a Pablo y no sigas como si nada.`);
    }
    informe.push(...lineas);
  }
  [...titulares, ...informe].forEach((l) => escribir(l));
  return titulares.length;
}

// El JSON del gancho por stdin. Sin stdin (lanzado a mano en una terminal) o vacío no hay entrada: los pasos que la necesitan lo dicen.
// Un JSON roto no se esconde: se lanza y sale como fallo de arranque en el titular.
async function leerEntrada() {
  if (process.stdin.isTTY) return null;
  let crudo = '';
  for await (const trozo of process.stdin) crudo += trozo;
  return crudo.trim() ? JSON.parse(crudo) : null;
}

const ARGV_START = 2; // node y el script van primero

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let args;
  try {
    args = leerArgumentos(process.argv.slice(ARGV_START));
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(e.exit);
  }
  let entrada = null;
  try {
    entrada = await leerEntrada();
  } catch (e) {
    console.log(`FÁBRICA AL ARRANCAR: FALLÓ la lectura de la entrada del gancho: ${e.message}. Díselo a Pablo y no sigas como si nada.`);
  }
  arrancar(args.solo === null ? PASOS : PASOS.filter((p) => p.nombre === args.solo), console.log, entrada);
}
