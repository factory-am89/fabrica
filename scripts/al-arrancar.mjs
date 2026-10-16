// Lo que se hace al arrancar una sesión: .claude/settings.json lanza solo este script (SessionStart).
// Un paso nuevo se añade a PASOS, no a settings.json. Un paso que falla se dice y no impide los demás.
//
// Canales (SessionStart de Claude Code): con salida 0, stdout llega a la sesión; con cualquier otra salida
// solo se ve stderr. Por eso: sin fallos, el informe va a stdout y se sale con 0; si un paso falla, su informe y
// el fallo van a stderr (lo ve Pablo) y se sale con 1. Nunca un fallo por stdout con salida 1: nadie lo vería.
import { fileURLToPath } from 'node:url';
import { limpiar, imprimir } from './limpiar.mjs';

export const pasoLimpiar = (limpiarFn = limpiar) => ({
  nombre: 'limpiar',
  ejecutar: (escribir) => {
    const s = limpiarFn();
    imprimir(s, escribir);
    if (s.fallos > 0) throw new Error(`${s.fallos} cosas sin borrar (arriba)`);
  },
});

export const PASOS = [pasoLimpiar()];

const CANALES = { salida: (l) => console.log(l), error: (l) => console.error(l) };

// Devuelve cuántos pasos fallaron.
export function arrancar(pasos = PASOS, { salida, error } = CANALES) {
  let fallos = 0;
  for (const paso of pasos) {
    const lineas = [];
    try {
      paso.ejecutar((l) => lineas.push(l));
      lineas.forEach(salida);
    } catch (e) {
      fallos += 1;
      lineas.forEach(error);
      error(`al-arrancar FALLÓ el paso «${paso.nombre}»: ${e.message}`);
    }
  }
  return fallos;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(arrancar() > 0 ? 1 : 0);
}
