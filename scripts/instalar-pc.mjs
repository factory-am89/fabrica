// Capa de usuario versionada: usuario/ (hoy solo CLAUDE.md global; admite subcarpetas) <-> ~/.claude/.
//   node scripts/instalar-pc.mjs instalar    copia lo que falta o difiere y apunta la huella
//   node scripts/instalar-pc.mjs comprobar   sale con 1 y nombra cada fichero que no coincide
// HOME inyectable: variable FABRICA_HOME (o el parámetro `home`). Sin ella, el HOME real.
// Fuera de alcance a propósito: settings.json (trozo 4b) y memorias.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ORIGEN = path.join(RAIZ, 'usuario');
export const HUELLA = 'fabrica-huella.json'; // dentro de ~/.claude/

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

const sitio = (home) => path.join(home ?? process.env.FABRICA_HOME ?? homedir(), '.claude');

// Estado de cada fichero de usuario/ en el destino: ok, falta, editado-a-mano o desactualizado.
export function estado({ home, origen = ORIGEN } = {}) {
  const destino = sitio(home);
  const huella = leerHuella(destino);
  return listar(origen).map((fichero) => {
    const fuente = hash(readFileSync(path.join(origen, fichero)));
    const f = path.join(destino, fichero);
    if (!existsSync(f)) return { fichero, estado: 'falta', fuente };
    const actual = hash(readFileSync(f));
    if (actual === fuente) return { fichero, estado: 'ok', fuente };
    // Igual a lo que se instaló: el repo avanzó. Distinto: alguien lo tocó en destino.
    return { fichero, estado: actual === huella[fichero] ? 'desactualizado' : 'editado-a-mano', fuente };
  });
}

export function instalar({ home, origen = ORIGEN } = {}) {
  const destino = sitio(home);
  const previo = estado({ home, origen });
  const cambiados = [];
  for (const { fichero, estado: e } of previo) {
    if (e === 'ok') continue;
    const f = path.join(destino, fichero);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, readFileSync(path.join(origen, fichero)));
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
      const c = instalar();
      if (!c.length) console.log('instalar-pc: sin cambios');
      for (const { fichero, antes } of c) console.log(`instalar-pc: ${fichero} (${antes})`);
    } else if (orden === 'comprobar') {
      const mal = comprobar();
      for (const { fichero, estado: e } of mal) console.error(`comprobar-pc: ${fichero} ${e}`);
      if (mal.length) process.exit(1);
      console.log('comprobar-pc: coincide');
    } else {
      throw new Error('Uso: instalar-pc.mjs instalar | comprobar');
    }
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
