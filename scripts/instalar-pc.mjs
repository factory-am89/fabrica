// Capa de usuario versionada: usuario/ (CLAUDE.md global y, si lo hay, settings.json; admite subcarpetas) <-> ~/.claude/.
//   node scripts/instalar-pc.mjs instalar              copia lo que falta o difiere y apunta la huella
//   node scripts/instalar-pc.mjs instalar --ampliar    igual, aunque settings.json amplíe permisos: SOLO desde una
//                                                      terminal interactiva y tecleando AMPLIAR (solo Pablo)
//   node scripts/instalar-pc.mjs comprobar             sale con 1 y nombra cada fichero que no coincide
// Si el settings.json nuevo AMPLÍA permisos respecto al instalado (scripts/lib/ampliacion-settings.mjs), instalar sale
// con 1 sin escribir NADA. --ampliar no basta: sin terminal (las sesiones de Claude no la tienen) o sin la
// confirmación, sale con 1 igual. Quitar permisos se aplica solo.
// HOME inyectable: FABRICA_HOME (o el parámetro `home`); origen: FABRICA_USUARIO (o `origen`). Sin ellas, los reales.
// usuario/settings.json puede ser una PLANTILLA pública: lo privado son huecos {{nombre}} (scripts/lib/plantilla.mjs).
// Los valores viven en un repo privado, clonado aparte: fichero JSON nombre -> valor en FABRICA_VALORES, o por defecto
// <carpeta de los repos>/fabrica-privado/usuario/valores.json (C:\dev\fabrica-privado\usuario\valores.json).
// Sin fichero, hueco sin valor o valor sobrante: error y no se escribe nada. Se instala y se comprueba el resultado RELLENO.
// Fuera de alcance a propósito: memorias.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ampliaciones } from './lib/ampliacion-settings.mjs';
import { huecos, rellenar } from './lib/plantilla.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ORIGEN = path.join(RAIZ, 'usuario');
export const HUELLA = 'fabrica-huella.json'; // dentro de ~/.claude/
export const VALORES_POR_DEFECTO = path.join(RAIZ, '..', 'fabrica-privado', 'usuario', 'valores.json');

const hash = (buf) => createHash('sha256').update(buf).digest('hex');

// Rutas relativas (con «/») de todos los ficheros bajo `dir`, en orden.
function listar(dir, rel = '') {
  const salida = [];
  for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) salida.push(...listar(dir, r));
    else salida.push(r);
  }
  return salida.sort();
}

function leerHuella(destino) {
  const f = path.join(destino, HUELLA);
  if (!existsSync(f)) return {};
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch (e) {
    throw new Error(`La huella ${f} no se puede leer; bórrala y reinstala.`, { cause: e });
  }
}

// Los valores privados de los huecos: el JSON del repo privado (FABRICA_VALORES o la ruta por defecto).
export function cargarValores(ruta = process.env.FABRICA_VALORES ?? VALORES_POR_DEFECTO) {
  if (!existsSync(ruta)) {
    throw new Error(
      `Falta el fichero de valores privados: ${ruta}\n` +
        'Clona el repo privado (fabrica-privado) ahí, o apunta FABRICA_VALORES a su usuario/valores.json.',
    );
  }
  try {
    return JSON.parse(readFileSync(ruta, 'utf8'));
  } catch (e) {
    throw new Error(`El fichero de valores ${ruta} no es un JSON válido.`, { cause: e });
  }
}

// Contenido que se instala de cada fichero de usuario/: tal cual, salvo settings.json si es plantilla, que se rellena.
// `valores` (objeto) se inyecta en tests; si no, se leen del fichero solo cuando la plantilla tiene huecos.
function contenidos(origen, valores) {
  return Object.fromEntries(
    listar(origen).map((fichero) => {
      const bruto = readFileSync(path.join(origen, fichero));
      if (fichero !== 'settings.json') return [fichero, bruto];
      const plantilla = leerJson(path.join(origen, fichero));
      if (!huecos(plantilla).length && valores === undefined) return [fichero, bruto];
      const rellena = rellenar(plantilla, valores ?? cargarValores());
      return [fichero, Buffer.from(`${JSON.stringify(rellena, null, 2)}\n`)];
    }),
  );
}

const sitio = (home) => path.join(home ?? process.env.FABRICA_HOME ?? homedir(), '.claude');

// Estado de cada fichero de usuario/ en el destino: ok, falta, editado-a-mano o desactualizado.
export function estado({ home, origen = ORIGEN, valores } = {}) {
  const destino = sitio(home);
  const huella = leerHuella(destino);
  const todos = contenidos(origen, valores);
  return Object.keys(todos).map((fichero) => {
    const fuente = hash(todos[fichero]);
    const f = path.join(destino, fichero);
    if (!existsSync(f)) return { fichero, estado: 'falta', fuente, contenido: todos[fichero] };
    const actual = hash(readFileSync(f));
    if (actual === fuente) return { fichero, estado: 'ok', fuente, contenido: todos[fichero] };
    // Igual a lo que se instaló: el repo avanzó. Distinto: alguien lo tocó en destino.
    return { fichero, estado: actual === huella[fichero] ? 'desactualizado' : 'editado-a-mano', fuente, contenido: todos[fichero] };
  });
}

export const CONFIRMACION = 'AMPLIAR';

export class AmpliaPermisos extends Error {
  constructor(motivos, causa = 'no se ha pedido --ampliar') {
    const lineas = motivos.map((m) => `  - ${m}`).join('\n');
    super(
      `settings.json amplía permisos y no se ha escrito nada (${causa}):\n${lineas}\n` +
        `Lo lanza Pablo en su terminal: npm run instalar-pc -- --ampliar (y teclea ${CONFIRMACION}).`,
    );
    this.motivos = motivos;
  }
}

// Una línea de la entrada estándar (terminal), leída byte a byte hasta el salto de línea.
function leerLineaDeTerminal() {
  const un = Buffer.alloc(1);
  let linea = '';
  while (readSync(0, un, 0, 1, null) === 1 && un[0] !== 10) linea += String.fromCharCode(un[0]);
  return linea;
}

// Devuelve la función `confirmar(motivos)` de instalar. Sin terminal interactiva lanza AmpliaPermisos;
// con ella, muestra la lista y solo da el visto bueno si se teclea exactamente CONFIRMACION.
export function confirmarEnTerminal({
  tty = Boolean(process.stdin.isTTY && process.stdout.isTTY),
  leerLinea = leerLineaDeTerminal,
  escribir = console.log,
} = {}) {
  return (motivos) => {
    if (!tty) throw new AmpliaPermisos(motivos, 'sin terminal interactiva');
    escribir(`settings.json amplía permisos:\n${motivos.map((m) => `  - ${m}`).join('\n')}`);
    escribir(`Para aplicarlo escribe ${CONFIRMACION} y Enter (otra cosa cancela):`);
    if (leerLinea().trim() !== CONFIRMACION) throw new AmpliaPermisos(motivos, 'confirmación incorrecta');
    return true;
  };
}

const leerJson = (f) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch (e) {
    throw new Error(`${f} no es un JSON válido.`, { cause: e });
  }
};

// `confirmar`: función que da el visto bueno a una ampliación o lanza; sin ella, una ampliación no se aplica.
export function instalar({ home, origen = ORIGEN, confirmar, valores } = {}) {
  const destino = sitio(home);
  const previo = estado({ home, origen, valores });
  const ajustes = previo.find((p) => p.fichero === 'settings.json');
  if (ajustes && ajustes.estado !== 'ok') {
    const actual = ajustes.estado === 'falta' ? {} : leerJson(path.join(destino, 'settings.json'));
    const motivos = ampliaciones(actual, JSON.parse(ajustes.contenido.toString('utf8')));
    if (motivos.length && !(confirmar && confirmar(motivos) === true)) throw new AmpliaPermisos(motivos);
  }
  const cambiados = [];
  for (const { fichero, estado: e, contenido } of previo) {
    if (e === 'ok') continue;
    const f = path.join(destino, fichero);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, contenido);
    cambiados.push({ fichero, antes: e });
  }
  const huella = Object.fromEntries(previo.map((p) => [p.fichero, p.fuente]));
  const texto = `${JSON.stringify(huella, null, 2)}\n`;
  const fh = path.join(destino, HUELLA);
  if (!existsSync(fh) || readFileSync(fh, 'utf8') !== texto) {
    mkdirSync(destino, { recursive: true });
    writeFileSync(fh, texto);
  }
  return cambiados;
}

export const comprobar = (opciones) => estado(opciones).filter((p) => p.estado !== 'ok');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const orden = process.argv[2];
  try {
    if (orden === 'instalar') {
      const c = instalar({
        origen: process.env.FABRICA_USUARIO,
        confirmar: process.argv.includes('--ampliar') ? confirmarEnTerminal() : undefined,
      });
      if (!c.length) console.log('instalar-pc: sin cambios');
      for (const { fichero, antes } of c) console.log(`instalar-pc: ${fichero} (${antes})`);
    } else if (orden === 'comprobar') {
      const mal = comprobar({ origen: process.env.FABRICA_USUARIO });
      for (const { fichero, estado: e } of mal) console.error(`comprobar-pc: ${fichero} ${e}`);
      if (mal.length) process.exit(1);
      console.log('comprobar-pc: coincide');
    } else {
      throw new Error('Uso: instalar-pc.mjs instalar [--ampliar] | comprobar');
    }
  } catch (e) {
    console.error(e.message);
    process.exit(e instanceof AmpliaPermisos ? 1 : 2);
  }
}
