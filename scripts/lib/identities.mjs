// Las identidades con las que se habla a GitHub: UN solo mapa, del que salen la validación de la ficha
// (lib/repo-card.mjs), el lanzador de las órdenes, si se pueden borrar ramas remotas (clean.mjs) y la App con
// la que firma scripts/token.mjs.
//   lanzador      script que lanza `-- gh api <ruta>` / `-- git ...` con esa identidad
//   borraRemotas  si con ella se pueden borrar ramas remotas
//   duenos        lista cerrada de dueños de repos donde vale (null: cualquiera, solo para una identidad sin escritura)
//   app           la App que firma (null: sin credencial). clientId no es secreto; documento es el nombre de su clave
//                 privada en 1Password y boveda la caja donde está (el secreto es la clave, nunca se escribe aquí)
import { fileURLToPath } from 'node:url';
import { REPO, OWNER_LOGIN, CLIENT_ID_CONSTRUCTOR } from './repo.mjs';

// La App fabrica-constructor, vía scripts/token.mjs (única puerta; gh a pelo no tiene sesión en este PC).
export const TOKEN = fileURLToPath(new URL('../token.mjs', import.meta.url));

export const IDENTIDADES = {
  'fabrica-constructor': {
    lanzador: TOKEN, borraRemotas: true, duenos: [REPO.split('/')[0], OWNER_LOGIN],
    app: { clientId: CLIENT_ID_CONSTRUCTOR, documento: 'fabrica-constructor.pem', boveda: 'Fabrica' },
  },
  // Sin credencial: solo lectura de un repo público (lib/gh-public.mjs).
  ninguna: { lanzador: fileURLToPath(new URL('./gh-public.mjs', import.meta.url)), borraRemotas: false, duenos: null, app: null },
};

export const NOMBRES_IDENTIDAD = Object.keys(IDENTIDADES);

// La variable de entorno con la que una persona elige su identidad en su PC (una por PC). Su único lector es identidadActiva.
export const VARIABLE_IDENTIDAD = 'FABRICA_IDENTIDAD';

export function identidadDe(nombre) {
  if (!Object.hasOwn(IDENTIDADES, nombre)) throw new Error(`Identidad desconocida: ${nombre} (valen: ${NOMBRES_IDENTIDAD.join(', ')})`);
  return IDENTIDADES[nombre];
}

// ¿Vale la identidad `nombre` en un repo de `dueno`? Falla en alto si no.
function exigirDueno(nombre, dueno, origen) {
  const { duenos } = identidadDe(nombre);
  if (duenos && !duenos.some((d) => d.toLowerCase() === dueno.toLowerCase())) {
    throw new Error(`${origen}: la identidad ${nombre} solo vale en repos de ${duenos.join(', ')}; ${dueno} no vale.`);
  }
}

// La identidad con la que se habla a GitHub para `ficha` ({ repo: 'dueño/nombre', identidad }): la de la variable
// VARIABLE_IDENTIDAD si está puesta, y si no la de la ficha, como siempre. Las dos se validan contra el dueño del repo:
// una identidad que no existe o que no vale en ese dueño falla en alto, nunca se cambia por otra.
// Devuelve { nombre, origen, ...la entrada de IDENTIDADES }; `origen` dice de dónde salió (la variable o la ficha).
// `donde` nombra la ficha en el error (leerFicha pasa su ruta).
export function identidadActiva(env, ficha, donde = `La ficha de ${ficha.repo}`) {
  const dueno = ficha.repo.split('/')[0];
  exigirDueno(ficha.identidad, dueno, donde);
  const crudo = env[VARIABLE_IDENTIDAD];
  if (crudo === undefined) return { nombre: ficha.identidad, origen: 'ficha', ...IDENTIDADES[ficha.identidad] };
  const nombre = crudo.trim();
  if (!nombre) throw new Error(`${VARIABLE_IDENTIDAD} está puesta pero vacía: quítala o pon una de ${NOMBRES_IDENTIDAD.join(', ')}.`);
  exigirDueno(nombre, dueno, `${VARIABLE_IDENTIDAD}=${nombre}`);
  return { nombre, origen: VARIABLE_IDENTIDAD, ...IDENTIDADES[nombre] };
}
