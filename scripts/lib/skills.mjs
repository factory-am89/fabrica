// La forja mínima: comprueba la forma de una skill según base/skill.md. Devuelve la lista de
// faltas (vacía si está bien); no tira ni corrige nada.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const MAX_LINEAS = 120;
export const REVISAR_DIAS = 90;
export const MAX_DESCRIPCION = 600;
const CAMPOS = ['name', 'description', 'dueño', 'comprobado'];
const SENSIBLE = [
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
    if (e === 'SKILL.md') continue;
    if (e !== 'referencias' || !statSync(path.join(carpeta, e)).isDirectory()) {
      faltas.push(`sobra «${e}»: solo caben SKILL.md y referencias/`);
      continue;
    }
    for (const r of readdirSync(path.join(carpeta, e))) {
      if (!texto.includes(`referencias/${r}`)) faltas.push(`referencias/${r} no la cita SKILL.md (huérfana)`);
    }
  }
  return faltas;
}

export function comprobarSkill(carpeta, { raiz, hoy }) {
  const ruta = path.join(carpeta, 'SKILL.md');
  if (!existsSync(ruta)) return ['no tiene SKILL.md'];
  const texto = readFileSync(ruta, 'utf8');
  const f = leerFrontmatter(texto);
  if (!f) return ['el frontmatter no existe o tiene una línea que no es «campo: valor»'];
  const faltas = faltasDeCabecera(f, carpeta, raiz, hoy);
  const lineas = texto.replace(/\n$/, '').split('\n').length;
  if (lineas > MAX_LINEAS) faltas.push(`SKILL.md tiene ${lineas} líneas (máximo ${MAX_LINEAS}): el detalle va a referencias/`);
  const falló = texto.split(/^## Lo que falló\s*$/m)[1];
  if (falló === undefined) faltas.push('falta la sección «## Lo que falló»');
  else if (!/^- \*\*/m.test(falló.split(/^## /m)[0])) faltas.push('«Lo que falló» no tiene ninguna lección («- **fecha · síntoma.** Causa… Arreglo…»)');
  for (const [re, que] of SENSIBLE) if (re.test(texto)) faltas.push(`parece llevar ${que}`);
  return [...faltas, ...faltasDeCarpeta(carpeta, texto)];
}

// Skills que llevan más de REVISAR_DIAS días sin revisar. Informa, no falla: lo lee `npm run skills-viejas`.
// `hoy` entra siempre por parámetro. Si no puede leer las skills, lanza (no devuelve [] como si todo estuviera al día).
export function skillsViejas(raiz, hoy) {
  const dir = path.join(raiz, '.claude', 'skills');
  if (!existsSync(dir)) throw new Error(`no existe ${dir}: no se puede saber qué skills están viejas`);
  const viejas = [];
  for (const carpeta of carpetasDeSkills(raiz)) {
    const nombre = path.basename(carpeta);
    const f = leerFrontmatter(readFileSync(path.join(carpeta, 'SKILL.md'), 'utf8'));
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
