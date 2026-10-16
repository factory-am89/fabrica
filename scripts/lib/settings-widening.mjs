// ¿Aplicar `nuevo` sobre `actual` (dos settings.json ya leídos) AMPLÍA lo que Claude Code puede hacer solo?
// Devuelve una lista de motivos; vacía = no amplía. Quitar permisos conocidos nunca es ampliar.
// Una ampliación la aplica Pablo, no una sesión (principio: ampliar permisos es de Pablo).
//
// LISTA CERRADA AL REVÉS: lo único que se deja cambiar sin aviso es lo que está en CLAVES_SEGURAS (con su motivo)
// y lo que miran las reglas de abajo (permisos, hooks, autoMode, plugins). CUALQUIER otro cambio en CUALQUIER otra clave,
// conocida o no (una `permissions.ask` quitada, una `statusLine` que ejecuta una orden, otra variable de `env`...),
// cuenta como ampliación: ante la duda, no se aplica sin Pablo. Para dejar pasar una clave nueva hay que añadirla
// aquí con su motivo, en un PR que lo diga.
//
// Un defaultMode que no conocemos cuenta como ampliación. Un valor que existe y no tiene la forma esperada
// (una lista que no es lista, un objeto que no es objeto) LANZA: esta es la puerta de seguridad y no puede leer
// mal en silencio. Ausente (undefined o null) = vacío.

// Rutas (con «*» por «cualquier nombre») que NO amplían nada, cada una con su motivo.
export const CLAVES_SEGURAS = [
  { ruta: ['model'], motivo: 'Elige el modelo; no concede permisos ni ejecuta nada.' },
  { ruta: ['env', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW'], motivo: 'Tamaño de la ventana a partir de la cual se compacta la conversación.' },
  { ruta: ['promptCacheTtl'], motivo: 'Duración de la caché del prompt; solo coste y velocidad.' },
  { ruta: ['effortLevel'], motivo: 'Esfuerzo de razonamiento por defecto; no concede permisos.' },
  { ruta: ['modelSettings', '*', 'effortLevel'], motivo: 'Esfuerzo de razonamiento de un modelo concreto.' },
  { ruta: ['tui'], motivo: 'Aspecto de la interfaz de terminal.' },
  { ruta: ['agentPushNotifEnabled'], motivo: 'Avisos al móvil cuando un agente termina.' },
];

// Ramas que miran las reglas de abajo (por eso no pasan por la lista cerrada).
const MANEJADAS = [
  ['permissions', 'allow'],
  ['permissions', 'deny'],
  ['permissions', 'additionalDirectories'],
  ['permissions', 'defaultMode'],
  ['hooks'],
  ['autoMode', 'environment'],
  ['autoMode', 'allow'],
  ['autoMode', 'soft_deny'],
  ['enabledPlugins'],
];

// De más a menos restrictivo. dontAsk no pregunta pero deniega lo no permitido: lo más cerrado.
const MODOS = ['dontAsk', 'plan', 'default', 'acceptEdits', 'auto', 'bypassPermissions'];

const ausente = (v) => v === undefined || v === null;
const lista = (v, donde) => {
  if (ausente(v)) return [];
  if (!Array.isArray(v)) throw new Error(`settings mal formado: ${donde} debe ser una lista y es ${JSON.stringify(v)}`);
  return v;
};
const objeto = (v, donde) => {
  if (ausente(v)) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`settings mal formado: ${donde} debe ser un objeto y es ${JSON.stringify(v)}`);
  return v;
};
// Las dos listas se validan siempre (aunque una esté vacía): si no, un valor roto podría pasar sin leerse.
// `lados` nombra (antes, despues) para el mensaje de error; al revés cuando se busca lo QUITADO.
const nuevos = (antes, despues, donde, lados = ['actual', 'nuevo']) => {
  const previas = lista(antes, `${lados[0]}.${donde}`);
  return lista(despues, `${lados[1]}.${donde}`).filter((x) => !previas.includes(x));
};
const clave = (x) => JSON.stringify(x);

// Cada hook como texto «Evento|matcher|definición», para comparar sin depender del orden.
function hooksPlanos(settings, lado) {
  const salida = [];
  for (const [evento, grupos] of Object.entries(objeto(settings.hooks, `${lado}.hooks`))) {
    for (const g of lista(grupos, `${lado}.hooks.${evento}`)) {
      for (const h of lista(objeto(g, `${lado}.hooks.${evento}[]`).hooks, `${lado}.hooks.${evento}[].hooks`)) {
        salida.push(`${evento}|${g.matcher ?? ''}|${clave(h)}`);
      }
    }
  }
  return salida;
}

const empieza = (ruta, prefijo) => prefijo.every((p, i) => ruta[i] === p);
const encaja = (ruta, patron) => ruta.length === patron.length && patron.every((p, i) => p === '*' || p === ruta[i]);

// Hojas «ruta -> valor en texto» de todo lo que NO miran las reglas específicas. Las listas son una hoja.
function hojas(nodo, ruta = [], salida = new Map()) {
  if (MANEJADAS.some((m) => empieza(ruta, m))) return salida;
  if (nodo !== null && typeof nodo === 'object' && !Array.isArray(nodo)) {
    // Un objeto vacío no dice nada: es lo mismo que no estar.
    for (const [k, v] of Object.entries(nodo)) hojas(v, [...ruta, k], salida);
  } else {
    salida.set(ruta.join('.'), { ruta, valor: clave(nodo) });
  }
  return salida;
}

// Todo cambio fuera de la lista cerrada (añadido, quitado o distinto) es una ampliación.
function cambiosFueraDeLaLista(a, n) {
  const motivos = [];
  const antes = hojas(a);
  const despues = hojas(n);
  for (const nombre of new Set([...antes.keys(), ...despues.keys()])) {
    const x = antes.get(nombre);
    const y = despues.get(nombre);
    if (x?.valor === y?.valor) continue;
    const ruta = (x ?? y).ruta;
    if (CLAVES_SEGURAS.some((c) => encaja(ruta, c.ruta))) continue;
    motivos.push(`clave fuera de la lista cerrada cambiada: ${nombre}`);
  }
  return motivos;
}

export function ampliaciones(actual, nuevo) {
  const motivos = [];
  const a = objeto(actual, 'actual');
  const n = objeto(nuevo, 'nuevo');
  const pa = objeto(a.permissions, 'actual.permissions');
  const pn = objeto(n.permissions, 'nuevo.permissions');
  const ma = objeto(a.autoMode, 'actual.autoMode');
  const mn = objeto(n.autoMode, 'nuevo.autoMode');

  for (const r of nuevos(pa.allow, pn.allow, 'permissions.allow')) motivos.push(`regla allow nueva: ${r}`);
  for (const d of nuevos(pa.additionalDirectories, pn.additionalDirectories, 'permissions.additionalDirectories')) {
    motivos.push(`directorio adicional nuevo: ${d}`);
  }
  // Quitar una regla deny también abre lo que cerraba.
  for (const r of nuevos(pn.deny, pa.deny, 'permissions.deny', ['nuevo', 'actual'])) motivos.push(`regla deny quitada: ${r}`);

  const modoNuevo = pn.defaultMode ?? 'default';
  const modoActual = pa.defaultMode ?? 'default';
  if (modoNuevo !== modoActual) {
    const i = MODOS.indexOf(modoNuevo);
    if (i === -1) motivos.push(`defaultMode desconocido: ${modoNuevo}`);
    else if (MODOS.indexOf(modoActual) === -1 || i > MODOS.indexOf(modoActual)) {
      motivos.push(`defaultMode más permisivo: ${modoActual} -> ${modoNuevo}`);
    }
  }

  const hooksActuales = hooksPlanos(a, 'actual');
  for (const h of hooksPlanos(n, 'nuevo')) if (!hooksActuales.includes(h)) motivos.push(`hook nuevo: ${h}`);

  // autoMode: más entorno de confianza o menos soft_deny = el clasificador deja pasar más.
  for (const e of nuevos(ma.environment, mn.environment, 'autoMode.environment')) motivos.push(`autoMode.environment nuevo: ${e}`);
  for (const e of nuevos(ma.allow, mn.allow, 'autoMode.allow')) motivos.push(`autoMode.allow nuevo: ${e}`);
  for (const e of nuevos(mn.soft_deny, ma.soft_deny, 'autoMode.soft_deny', ['nuevo', 'actual'])) {
    motivos.push(`autoMode.soft_deny quitado: ${e}`);
  }

  // Un plugin activado trae sus propios hooks y herramientas.
  const plugins = objeto(a.enabledPlugins, 'actual.enabledPlugins');
  for (const [p, on] of Object.entries(objeto(n.enabledPlugins, 'nuevo.enabledPlugins'))) {
    if (on && !plugins[p]) motivos.push(`plugin activado: ${p}`);
  }

  motivos.push(...cambiosFueraDeLaLista(a, n));
  return motivos;
}
