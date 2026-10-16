// Lo que se hace al arrancar una sesión: .claude/settings.json lanza solo este script (SessionStart).
// Un paso nuevo se añade a PASOS, no a settings.json. Un paso que falla se dice y no impide los demás.
//
// Siempre sale con 0 y todo va a stdout: en SessionStart, Claude Code añade el stdout como contexto que Claude ve
// y puede usar (https://code.claude.com/docs/en/hooks); con otra salida solo habría un aviso con la 1.ª línea de stderr.
// Si un paso falla, la primera línea lo dice sin ambigüedad y luego va el detalle: la sesión debe enterarse.
import { fileURLToPath } from 'node:url';
import { limpiar, imprimir } from './limpiar.mjs';
import { pasoAlDia } from './al-dia.mjs';
import { pasoHora } from './hora.mjs';

export const pasoLimpiar = (limpiarFn = limpiar) => ({
  nombre: 'limpiar',
  ejecutar: (escribir) => {
    const s = limpiarFn();
    imprimir(s, escribir);
    if (s.fallos > 0) throw new Error(`${s.fallos} cosas sin borrar (arriba)`);
  },
});

// al-dia primero: trae a la principal la ficha .fabrica.json (y lo nuevo) antes de que limpiar la lea.
export const PASOS = [pasoAlDia(), pasoLimpiar(), pasoHora()];

// Devuelve cuántos pasos fallaron. Los titulares de fallo van primero y luego el informe de cada paso.
export function arrancar(pasos = PASOS, escribir = console.log) {
  const titulares = [];
  const informe = [];
  for (const paso of pasos) {
    const lineas = [];
    try {
      paso.ejecutar((l) => lineas.push(l));
    } catch (e) {
      titulares.push(`FÁBRICA AL ARRANCAR: FALLÓ el paso «${paso.nombre}»: ${e.message}. Díselo a Pablo y no sigas como si nada.`);
    }
    informe.push(...lineas);
  }
  [...titulares, ...informe].forEach((l) => escribir(l));
  return titulares.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  arrancar();
}
