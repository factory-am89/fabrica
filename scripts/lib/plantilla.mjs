// Plantillas con huecos: un JSON público con `{{nombre}}` donde va un dato privado, y un fichero de valores
// (JSON nombre -> valor) que vive en otro repo, privado. Aquí solo la mecánica; ningún valor.
//   - Un texto que es EXACTAMENTE `{{nombre}}` se sustituye por el valor, del tipo que sea (lista, objeto, texto).
//   - Un `{{nombre}}` dentro de un texto más largo se sustituye por el valor, que debe ser un texto.
// Falla en alto, antes de escribir nada: hueco sin valor, valor sin hueco, valor de tipo que no encaja.
const HUECO = /\{\{([A-Za-z0-9_.-]+)\}\}/g;
const ENTERO = /^\{\{([A-Za-z0-9_.-]+)\}\}$/;

function recorrer(nodo, visita) {
  if (typeof nodo === 'string') return visita(nodo);
  if (Array.isArray(nodo)) return nodo.map((x) => recorrer(x, visita));
  if (nodo && typeof nodo === 'object') {
    return Object.fromEntries(Object.entries(nodo).map(([k, v]) => [k, recorrer(v, visita)]));
  }
  return nodo;
}

// Nombres de todos los huecos de una plantilla ya leída, sin repetir y en orden.
export function huecos(plantilla) {
  const nombres = new Set();
  recorrer(plantilla, (t) => {
    for (const m of t.matchAll(HUECO)) nombres.add(m[1]);
    return t;
  });
  return [...nombres].sort();
}

// `valores` es un objeto nombre -> valor. Devuelve la plantilla rellena (copia).
export function rellenar(plantilla, valores) {
  if (valores === null || typeof valores !== 'object' || Array.isArray(valores)) {
    throw new Error('El fichero de valores debe ser un objeto JSON nombre -> valor.');
  }
  const pedidos = huecos(plantilla);
  const faltan = pedidos.filter((n) => !(n in valores));
  const sobran = Object.keys(valores).filter((n) => !pedidos.includes(n));
  if (faltan.length || sobran.length) {
    const partes = [];
    if (faltan.length) partes.push(`faltan valores para: ${faltan.join(', ')}`);
    if (sobran.length) partes.push(`sobran valores sin hueco: ${sobran.join(', ')}`);
    throw new Error(`Los valores no encajan con la plantilla (${partes.join('; ')}).`);
  }
  return recorrer(plantilla, (t) => {
    const entero = ENTERO.exec(t);
    if (entero) return structuredClone(valores[entero[1]]); // copia: el resultado no comparte nada con los valores
    return t.replace(HUECO, (_, n) => {
      if (typeof valores[n] !== 'string') throw new Error(`El hueco {{${n}}} va dentro de un texto y su valor no es un texto.`);
      return valores[n];
    });
  });
}
