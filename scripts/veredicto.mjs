// Convierte la salida del revisor en un veredicto y lo publica como la App
// fabrica-revisor: un check `revisor` y, si es sí, una aprobación.
// El veredicto lo calcula este código, no el modelo: falla en alto (cualquier
// hueco o duda es «no»). Variables: SALIDA, REPO, PR, SHA, TOKEN (token de la App) y STANDARD
// (obligatoria, sin valor por defecto: la ruta del estándar, p. ej. .fabrica/standards/code.md).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readQuestions } from './lib/questions.mjs';
import { ANSWER, ANSWERS, ERROR, STANDARD_SOURCE, buildRecord, formatBlock, runFromEnv } from './lib/record.mjs';

// Las preguntas salen de standards/code.md (único lector: scripts/lib/questions.mjs). El juez solo conoce el prefijo C.
export function leerPreguntas(md) {
  return readQuestions(md).map((q) => ({ id: q.id, pregunta: q.text, quien: q.checkedBy }));
}

// STANDARD es «standards/<nombre>.md», con o sin el prefijo «.fabrica/» del workflow; se resuelve
// contra la raíz del repo que contiene este script (en CI, .fabrica/; en los tests, la carpeta de trabajo).
export const RUTA_ESTANDAR = new RegExp(String.raw`^(\.fabrica/)?(${STANDARD_SOURCE})$`);
const RAIZ = path.resolve(import.meta.dirname, '..');

export function rutaEstandar(valor, raiz = RAIZ) {
  const m = typeof valor === 'string' ? valor.match(RUTA_ESTANDAR) : null;
  if (!m) throw new Error('STANDARD debe ser standards/<nombre>.md (con o sin el prefijo .fabrica/); no tiene valor por defecto');
  return path.join(raiz, ...m[2].split('/'));
}

// Lee el estándar y falla en alto si no tiene ninguna pregunta del revisor: sin ellas el juez no
// preguntaría nada y daría un sí por vacío.
export function cargarPreguntas(valor, raiz = RAIZ) {
  const ruta = rutaEstandar(valor, raiz);
  let md;
  try {
    md = readFileSync(ruta, 'utf8');
  } catch {
    throw new Error('STANDARD no apunta a un fichero que exista');
  }
  const preguntas = leerPreguntas(md);
  if (!preguntas.some((q) => q.quien === 'revisor')) throw new Error('el estándar de STANDARD no tiene ninguna pregunta del revisor');
  return preguntas;
}

function normalizar(r) {
  const t = String(r ?? '').trim().toLowerCase();
  return t === 'si' ? ANSWER.yes : t;
}

// salida: texto JSON {respuestas:[{id, respuesta, prueba}]}
// ctx: { sha (el que se juzgó), cabeza (la cabeza actual del PR) }
// Solo ids, respuestas y veredicto salen de aquí: ningún texto libre del modelo.
export function decidir(salida, preguntas, ctx = {}) {
  const fallos = [];
  if (!ctx.sha || ctx.sha !== ctx.cabeza) fallos.push('la cabeza del PR ya no es el SHA juzgado');
  let datos;
  try {
    datos = JSON.parse(salida);
  } catch {
    return { ok: false, fallos: [...fallos, 'salida ilegible'], respuestas: null };
  }
  // Solo se aceptan ids C<número> que existan en la lista de preguntas; el resto se cuenta sin
  // escribirlo (lo que sale al check y al log nunca es texto del modelo).
  const conocidos = new Set(preguntas.map((q) => q.id));
  const repetidos = new Set();
  let sobrantes = 0;
  const porId = new Map();
  let desconocidos = 0;
  for (const r of Array.isArray(datos?.respuestas) ? datos.respuestas : []) {
    if (typeof r?.id !== 'string' || !/^C\d+$/.test(r.id) || !conocidos.has(r.id)) {
      desconocidos += 1;
      continue;
    }
    if (porId.has(r.id)) {
      repetidos.add(r.id);
      sobrantes += 1;
    }
    porId.set(r.id, r);
  }
  for (const id of repetidos) fallos.push(`${id}: id repetido`);
  if (desconocidos) fallos.push(`${desconocidos} ids desconocidos`);
  const delRevisor = preguntas.filter((q) => q.quien === 'revisor');
  if (delRevisor.length === 0) fallos.push('el estándar viene sin preguntas del revisor');
  for (const p of delRevisor) {
    const r = porId.get(p.id);
    const resp = normalizar(r?.respuesta);
    if (!r) fallos.push(`${p.id}: sin respuesta`);
    else if (!ANSWERS.includes(resp)) fallos.push(`${p.id}: respuesta no válida`);
    else if (resp === ANSWER.no) fallos.push(`${p.id}: no`);
    else if (!String(r.prueba ?? '').trim()) fallos.push(`${p.id}: sin prueba`);
  }
  // Lo que lee el registro (scripts/lib/record.mjs): las respuestas ya reducidas al vocabulario, de esta misma lectura.
  // Un id repetido no tiene respuesta utilizable (null); invalid = ids desconocidos + repeticiones sobrantes.
  const answers = {};
  for (const p of delRevisor) {
    const resp = normalizar(porId.get(p.id)?.respuesta);
    answers[p.id] = repetidos.has(p.id) || !ANSWERS.includes(resp) ? null : resp;
  }
  return { ok: fallos.length === 0, fallos, respuestas: { answers, invalid: desconocidos + sobrantes } };
}

async function api(token, metodo, ruta, cuerpo) {
  const res = await fetch(`https://api.github.com${ruta}`, {
    method: metodo,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (!res.ok) throw new Error(`${metodo} ${ruta} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function leerContexto({ repo, pr, sha, token }) {
  const datosPr = await api(token, 'GET', `/repos/${repo}/pulls/${pr}`);
  return { sha, cabeza: datosPr.head.sha };
}

// The record is one JSON line in a ```json block of output.text; title and summary are the ones decidir's veredicto gives.
async function publicar({ repo, pr, sha, token, veredicto, ctx, registro }) {
  const titulo = veredicto.ok ? 'Veredicto: sí' : 'Veredicto: no';
  const texto = veredicto.fallos.map((f) => `- ${f}`).join('\n') || 'Todas las respuestas del revisor son sí o no aplica, con prueba.';
  await api(token, 'POST', `/repos/${repo}/check-runs`, {
    name: 'revisor',
    head_sha: sha,
    status: 'completed',
    conclusion: veredicto.ok ? 'success' : 'failure',
    output: { title: titulo, summary: texto, ...(registro ? { text: formatBlock(registro) } : {}) },
  });
  // La aprobación de la App solo si el PR sigue en el SHA juzgado.
  if (veredicto.ok && ctx.sha === ctx.cabeza) {
    await api(token, 'POST', `/repos/${repo}/pulls/${pr}/reviews`, { commit_id: sha, event: 'APPROVE', body: 'Veredicto: sí.' });
  }
}

async function main() {
  const { SALIDA, REPO, PR, SHA, TOKEN, STANDARD } = process.env;
  for (const [k, v] of Object.entries({ REPO, PR, SHA, TOKEN })) {
    if (!v) throw new Error(`falta la variable ${k}`);
  }
  const ctx = await leerContexto({ repo: REPO, pr: PR, sha: SHA, token: TOKEN });
  let preguntas;
  let errorEstandar = null;
  try {
    preguntas = cargarPreguntas(STANDARD);
  } catch (e) {
    errorEstandar = e;
  }
  // Un estándar inválido es un no publicado (nunca un sí) y el script sale con error.
  const veredicto = errorEstandar ? { ok: false, fallos: ['el estándar no se pudo cargar'] } : decidir(SALIDA ?? '', preguntas, ctx);
  // El registro nunca cambia el veredicto: si no se puede construir, el veredicto se publica igual (sin registro) y el script falla en alto.
  let registro = null;
  let errorRegistro = null;
  try {
    const resumen = errorEstandar ? { answers: {}, invalid: 0 } : veredicto.respuestas;
    const estandar = (STANDARD ?? '').match(RUTA_ESTANDAR)?.[2] ?? null;
    registro = buildRecord({
      repo: REPO, pr: PR, sha: SHA, standard: estandar, veredicto,
      respuestas: resumen ?? { answers: {}, invalid: 0 },
      run: runFromEnv(process.env),
      error: errorEstandar ? ERROR.standardUnloadable : resumen ? null : ERROR.outputUnreadable,
    });
  } catch (e) {
    errorRegistro = e;
  }
  await publicar({ repo: REPO, pr: PR, sha: SHA, token: TOKEN, veredicto, ctx, registro });
  console.log(veredicto.ok ? 'veredicto: sí' : `veredicto: no\n${veredicto.fallos.join('\n')}`);
  if (errorEstandar) throw errorEstandar;
  if (errorRegistro) throw errorRegistro;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
