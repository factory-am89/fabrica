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

export const pasoLimpiar = (limpiarFn = limpiar) => ({
  nombre: 'limpiar',
  ejecutar: (escribir) => {
    const s = limpiarFn();
    imprimir(s, escribir);
    if (s.fallos > 0) throw new Error(`${s.fallos} cosas sin borrar (arriba)`);
  },
});

// al-dia primero: trae a la principal la ficha .fabrica.json (y lo nuevo) antes de que limpiar la lea.
export const PASOS = [pasoAlDia(), pasoLimpiar(), pasoSesiones(), pasoHora()];

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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let entrada = null;
  try {
    entrada = await leerEntrada();
  } catch (e) {
    console.log(`FÁBRICA AL ARRANCAR: FALLÓ la lectura de la entrada del gancho: ${e.message}. Díselo a Pablo y no sigas como si nada.`);
  }
  arrancar(PASOS, console.log, entrada);
}
