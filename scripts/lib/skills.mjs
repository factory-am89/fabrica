// La forja mínima: comprueba la forma de una skill según base/skill.md. Devuelve la lista de
// faltas (vacía si está bien); no tira ni corrige nada.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { readLessons, SIGNAL_MACHINE } from './lessons.mjs';

// Ratchet of the bullets of «Lo que falló» that have no lesson (chunk 6 of plans/trabajar-solos.md): a bullet is a rule
// with no reader until it links lessons/<id>.json. The number per skill lives in this file at the repo root, never in
// lessons/ (readLessons reads that whole folder as lessons).
export const RULES_BUDGET_FILE = 'rules-without-reader.json';
export const SKILL_FAULTS = Object.freeze(
  Object.fromEntries([
    'PROSE_DUPLICATES_TEST',
    'BUDGET_EXCEEDED',
    'BUDGET_NOT_LOWERED',
    'BUDGET_MISSING',
    'BUDGET_UNKNOWN_SKILL',
    'UNKNOWN_LESSON_LINK',
  ].map((c) => [c, c])),
);
const LESSON_LINK = /lessons\/([a-z0-9-]+)\.json/g;

// The folder layout of a skill: SKILL.md and, next to it, referencias/ (hygiene-refs.mjs reads the same names).
export const SKILL_FILE = 'SKILL.md';
export const REFERENCES_DIR = 'referencias';
export const MAX_LINEAS = 120;
export const REVISAR_DIAS = 90;
export const MAX_DESCRIPCION = 600;
const CAMPOS = ['name', 'description', 'dueño', 'comprobado'];
export const SENSIBLE = [
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/, 'una dirección IP'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY/, 'una clave privada'],
  [/\b(?:ghp_|github_pat_|ghs_|sk-ant-|ops_ey)[A-Za-z0-9_]{8,}/, 'un token'],
  [/\b[a-z]+:\/\/[^\s:@/]+:[^\s@/]+@/, 'una cadena de conexión con contraseña'],
];

export function leerFrontmatter(texto) {
  const m = texto.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const campos = {};
  for (const linea of m[1].split('\n')) {
    const kv = linea.match(/^([\p{L}_]+): ?(.*)$/u);
    if (!kv) return null;
    campos[kv[1]] = kv[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return campos;
}

// Única definición de «fecha válida»: AAAA-MM-DD y que Date.parse la entienda (rechaza 2026-13-45).
export function fechaValida(fecha) {
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha ?? '') && !Number.isNaN(Date.parse(fecha));
}

export function diasDesde(fecha, hoy) {
  return Math.floor((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${fecha}T00:00:00Z`)) / 86400000);
}

function faltasDeCabecera(f, carpeta, raiz, hoy) {
  const faltas = [];
  const claves = Object.keys(f).sort().join(',');
  if (claves !== [...CAMPOS].sort().join(',')) faltas.push(`campos del frontmatter: hay «${claves}», deben ser ${CAMPOS.join(', ')}`);
  if (f.name !== path.basename(carpeta)) faltas.push(`name «${f.name}» no es el de la carpeta «${path.basename(carpeta)}»`);
  const d = f.description ?? '';
  if (!/Úsala/.test(d)) faltas.push('description no dice cuándo usarla («Úsala …»)');
  if (!/No para:/.test(d)) faltas.push('description no dice cuándo no («No para: …»)');
  if (d.length > MAX_DESCRIPCION) faltas.push(`description tiene ${d.length} caracteres (máximo ${MAX_DESCRIPCION})`);
  if (!f['dueño'] || !existsSync(path.join(raiz, '.claude', 'agents', `${f['dueño']}.md`))) {
    faltas.push(`dueño «${f['dueño']}» no es un agente de .claude/agents/`);
  }
  if (!fechaValida(f.comprobado)) {
    faltas.push(`comprobado «${f.comprobado}» no es una fecha AAAA-MM-DD`);
  } else {
    const dias = diasDesde(f.comprobado, hoy);
    if (dias < 0) faltas.push(`comprobado ${f.comprobado} está en el futuro`);
  }
  return faltas;
}

function faltasDeCarpeta(carpeta, texto) {
  const faltas = [];
  for (const e of readdirSync(carpeta)) {
    if (e === SKILL_FILE) continue;
    if (e !== REFERENCES_DIR || !statSync(path.join(carpeta, e)).isDirectory()) {
      faltas.push(`sobra «${e}»: solo caben SKILL.md y referencias/`);
      continue;
    }
    for (const r of readdirSync(path.join(carpeta, e))) {
      if (!texto.includes(`referencias/${r}`)) faltas.push(`referencias/${r} no la cita SKILL.md (huérfana)`);
    }
  }
  return faltas;
}

// El texto de «## Lo que falló» hasta la siguiente sección; undefined si la skill no la tiene.
function seccionFalló(texto) {
  const resto = texto.split(/^## Lo que falló\s*$/m)[1];
  return resto === undefined ? undefined : resto.split(/^## /m)[0];
}

// Las viñetas de «Lo que falló» (cada una empieza en «- **» y sigue hasta la próxima viñeta): lista de textos.
export function viñetas(texto) {
  const falló = seccionFalló(texto);
  if (falló === undefined) throw new Error('la skill no tiene la sección «## Lo que falló»');
  return falló.split(/^(?=- \*\*)/m).filter((b) => b.startsWith('- **'));
}

function leerPresupuesto(raiz) {
  const fichero = path.join(raiz, RULES_BUDGET_FILE);
  if (!existsSync(fichero)) throw new Error(`no existe ${RULES_BUDGET_FILE} en ${raiz}`);
  let presupuesto;
  try {
    presupuesto = JSON.parse(readFileSync(fichero, 'utf8')).budget;
  } catch (e) {
    throw new Error(`${RULES_BUDGET_FILE} en ${raiz} no es un JSON legible`, { cause: e });
  }
  if (presupuesto === null || typeof presupuesto !== 'object' || Array.isArray(presupuesto)) {
    throw new Error(`${RULES_BUDGET_FILE} necesita un objeto «budget» con un número por skill`);
  }
  return presupuesto;
}

// Faltas del trinquete de todas las skills de `raiz`: el presupuesto de rules-without-reader.json solo baja.
// Lanza si el fichero no se puede leer (nunca se toma como «sin presupuesto»).
export function faltasDeReglasSinLector(raiz) {
  const presupuesto = leerPresupuesto(raiz);
  const lecciones = new Map(readLessons(raiz).map((l) => [l.id, JSON.parse(l.text)]));
  const faltas = [];
  const nombres = carpetasDeSkills(raiz).map((c) => path.basename(c));
  for (const n of Object.keys(presupuesto)) {
    if (!nombres.includes(n)) faltas.push({ code: SKILL_FAULTS.BUDGET_UNKNOWN_SKILL, where: n, message: `${RULES_BUDGET_FILE} lista «${n}», que no es una skill` });
  }
  for (const nombre of nombres) {
    const donde = `.claude/skills/${nombre}/SKILL.md`;
    let sinLeccion = 0;
    for (const v of viñetas(readFileSync(path.join(raiz, donde), 'utf8'))) {
      const ids = [...v.matchAll(LESSON_LINK)].map((m) => m[1]);
      for (const id of ids.filter((i) => !lecciones.has(i))) {
        faltas.push({ code: SKILL_FAULTS.UNKNOWN_LESSON_LINK, where: donde, message: `una viñeta cita lessons/${id}.json, que no existe` });
      }
      const maquina = ids.filter((i) => lecciones.get(i)?.signal === SIGNAL_MACHINE);
      if (maquina.length > 0) {
        faltas.push({ code: SKILL_FAULTS.PROSE_DUPLICATES_TEST, where: donde, message: `la viñeta «${v.slice(0, 50).trim()}…» enlaza lessons/${maquina[0]}.json (signal machine): el test ya es la memoria, bórrala` });
      } else if (ids.length === 0) sinLeccion += 1;
    }
    const tope = presupuesto[nombre];
    if (!Number.isInteger(tope) || tope < 0) {
      faltas.push({ code: SKILL_FAULTS.BUDGET_MISSING, where: nombre, message: `${RULES_BUDGET_FILE} no da un número entero a «${nombre}»` });
    } else if (sinLeccion > tope) {
      faltas.push({ code: SKILL_FAULTS.BUDGET_EXCEEDED, where: nombre, message: `${sinLeccion} viñetas sin lección, el presupuesto es ${tope}: subirlo es rebajar un check; añade la lección en lessons/` });
    } else if (sinLeccion < tope) {
      faltas.push({ code: SKILL_FAULTS.BUDGET_NOT_LOWERED, where: nombre, message: `${sinLeccion} viñetas sin lección y el presupuesto es ${tope}: bájalo a ${sinLeccion}` });
    }
  }
  return faltas;
}

export function comprobarSkill(carpeta, { raiz, hoy }) {
  const ruta = path.join(carpeta, SKILL_FILE);
  if (!existsSync(ruta)) return ['no tiene SKILL.md'];
  const texto = readFileSync(ruta, 'utf8');
  const f = leerFrontmatter(texto);
  if (!f) return ['el frontmatter no existe o tiene una línea que no es «campo: valor»'];
  const faltas = faltasDeCabecera(f, carpeta, raiz, hoy);
  const lineas = texto.replace(/\n$/, '').split('\n').length;
  if (lineas > MAX_LINEAS) faltas.push(`SKILL.md tiene ${lineas} líneas (máximo ${MAX_LINEAS}): el detalle va a referencias/`);
  const falló = seccionFalló(texto);
  if (falló === undefined) faltas.push('falta la sección «## Lo que falló»');
  else if (!/^- \*\*/m.test(falló)) faltas.push('«Lo que falló» no tiene ninguna lección («- **fecha · síntoma.** Causa… Arreglo…»)');
  for (const [re, que] of SENSIBLE) if (re.test(texto)) faltas.push(`parece llevar ${que}`);
  return [...faltas, ...faltasDeCarpeta(carpeta, texto)];
}

// Skills que llevan más de REVISAR_DIAS días sin revisar. Informa, no falla: lo lee `npm run stale-skills`.
// `hoy` entra siempre por parámetro. Si no puede leer las skills, lanza (no devuelve [] como si todo estuviera al día).
export function skillsViejas(raiz, hoy) {
  const dir = path.join(raiz, '.claude', 'skills');
  if (!existsSync(dir)) throw new Error(`no existe ${dir}: no se puede saber qué skills están viejas`);
  const viejas = [];
  for (const carpeta of carpetasDeSkills(raiz)) {
    const nombre = path.basename(carpeta);
    const f = leerFrontmatter(readFileSync(path.join(carpeta, SKILL_FILE), 'utf8'));
    if (!f || !fechaValida(f.comprobado)) throw new Error(`${nombre}: sin fecha «comprobado» legible`);
    const dias = diasDesde(f.comprobado, hoy);
    if (dias < 0) throw new Error(`${nombre}: comprobado ${f.comprobado} está en el futuro (hoy es ${hoy})`);
    if (dias > REVISAR_DIAS) viejas.push({ nombre, comprobado: f.comprobado, dias });
  }
  return viejas;
}

export function carpetasDeSkills(raiz) {
  const dir = path.join(raiz, '.claude', 'skills');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((n) => path.join(dir, n)).filter((p) => statSync(p).isDirectory());
}
