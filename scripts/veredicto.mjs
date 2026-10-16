// Convierte la salida del revisor en un veredicto y lo publica como la App
// fabrica-revisor: un check `revisor` y, si es sí, una aprobación.
// El veredicto lo calcula este código, no el modelo: falla en alto (cualquier
// hueco o duda es «no»). Variables: SALIDA, REPO, PR, SHA, TOKEN (token de la App) y STANDARD
// (obligatoria, sin valor por defecto: la ruta del estándar, p. ej. .fabrica/standards/code.md).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKED_BY, ID_SOURCE, readQuestions } from './lib/questions.mjs';
import { OWNER_LOGIN } from './lib/repo.mjs';
import { ANSWER, ANSWERS, ERROR, OVERRIDE_TITLE as TITULO_ANULACION, STANDARD_SOURCE, answersSummary, buildRecord, formatBlock, runFromEnv } from './lib/record.mjs';

// Las preguntas salen de standards/code.md (único lector: scripts/lib/questions.mjs). El juez solo conoce un prefijo
// (PREFIJO_DEL_JUEZ): un id es suyo si tiene la forma de id de questions.mjs (ID_SOURCE) y empieza por ese prefijo;
// las respuestas con cualquier otro id cuentan como desconocidas, también si el estándar tiene preguntas con ese id.
const PREFIJO_DEL_JUEZ = 'C';
const ID_DEL_JUEZ = new RegExp(`^(?=${ID_SOURCE}$)${PREFIJO_DEL_JUEZ}`);
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
  if (!preguntas.some((q) => q.quien === CHECKED_BY.reviewer)) throw new Error('el estándar de STANDARD no tiene ninguna pregunta del revisor');
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
    if (typeof r?.id !== 'string' || !ID_DEL_JUEZ.test(r.id) || !conocidos.has(r.id)) {
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
  const delRevisor = preguntas.filter((q) => q.quien === CHECKED_BY.reviewer);
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
  return { ok: fallos.length === 0, fallos, respuestas: answersSummary(answers, desconocidos + sobrantes) };
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

// La anulación por Pablo: la única salida cuando el revisor rechaza por error. Una review cuenta si y solo si
// (1) su autor es OWNER_LOGIN, (2) su última review decisiva (APPROVED, CHANGES_REQUESTED o DISMISSED; las COMMENTED
// no cuentan) es APPROVED y (3) su commit_id es exactamente la cabeza actual del PR. Un push posterior cambia la cabeza
// y la anulación deja de valer. `reviews` viene en orden cronológico, como la API. Devuelve la review o null.
const DECISIVAS = ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'];
export function aprobacionDePablo(reviews, cabeza, dueno = OWNER_LOGIN) {
  if (!/^[0-9a-f]{40}$/.test(String(cabeza))) return null;
  const suyas = (Array.isArray(reviews) ? reviews : []).filter(
    (r) => typeof r?.user?.login === 'string' && r.user.login.toLowerCase() === dueno.toLowerCase() && DECISIVAS.includes(r.state)
  );
  const ultima = suyas.at(-1);
  return ultima?.state === 'APPROVED' && ultima.commit_id === cabeza ? ultima : null;
}

// Resumen del check de anulación: quién, sobre qué cabeza y qué hallazgos del revisor se anulan.
export function resumenAnulacion(review, cabeza, hallazgos) {
  const lista = hallazgos.length ? hallazgos.map((f) => `- ${f}`).join('\n') : '- (ninguno recogido)';
  return `Anulado por la aprobación de ${review.user.login} (review ${review.id}) sobre ${cabeza}.\nHallazgos que se anulan:\n${lista}`;
}

async function reviewsDe({ repo, pr, token }) {
  const todas = [];
  for (let pagina = 1; ; pagina += 1) {
    const lote = await api(token, 'GET', `/repos/${repo}/pulls/${pr}/reviews?per_page=100&page=${pagina}`);
    todas.push(...lote);
    if (lote.length < 100) return todas;
  }
}

async function leerContexto({ repo, pr, sha, token }) {
  const datosPr = await api(token, 'GET', `/repos/${repo}/pulls/${pr}`);
  return { sha, cabeza: datosPr.head.sha, reviews: await reviewsDe({ repo, pr, token }) };
}

const publicarCheck = (repo, sha, token, conclusion, output) =>
  api(token, 'POST', `/repos/${repo}/check-runs`, { name: 'revisor', head_sha: sha, status: 'completed', conclusion, output });

// The record is one JSON line in a ```json block of output.text; title and summary are the ones decidir's veredicto gives.
async function publicar({ repo, pr, sha, token, veredicto, ctx, registro }) {
  const titulo = veredicto.ok ? 'Veredicto: sí' : 'Veredicto: no';
  const texto = veredicto.fallos.map((f) => `- ${f}`).join('\n') || 'Todas las respuestas del revisor son sí o no aplica, con prueba.';
  await publicarCheck(repo, sha, token, veredicto.ok ? 'success' : 'failure', { title: titulo, summary: texto, ...(registro ? { text: formatBlock(registro) } : {}) });
  // Si Pablo aprobó esta cabeza, el «no» (ya publicado, con su registro) queda anulado por un segundo check, el último.
  const aprobacion = !veredicto.ok && ctx.sha === ctx.cabeza ? aprobacionDePablo(ctx.reviews, ctx.cabeza) : null;
  if (aprobacion) await publicarCheck(repo, sha, token, 'success', { title: TITULO_ANULACION, summary: resumenAnulacion(aprobacion, sha, veredicto.fallos) });
  // La aprobación de la App solo si el PR sigue en el SHA juzgado.
  if (veredicto.ok && ctx.sha === ctx.cabeza) {
    await api(token, 'POST', `/repos/${repo}/pulls/${pr}/reviews`, { commit_id: sha, event: 'APPROVE', body: 'Veredicto: sí.' });
  }
}

// MODO=anulacion (lo lanza anulacion.yml tras una review): sin modelo. Solo si Pablo aprobó la cabeza actual y el
// último check `revisor` de esa cabeza, publicado por la App, no está en verde, publica el check de anulación.
async function anular({ REPO, PR, TOKEN }) {
  const ctx = await leerContexto({ repo: REPO, pr: PR, sha: null, token: TOKEN });
  const aprobacion = aprobacionDePablo(ctx.reviews, ctx.cabeza);
  if (!aprobacion) return console.log('anulación: no hay aprobación de Pablo sobre la cabeza actual; nada que hacer');
  const { check_runs: checks } = await api(TOKEN, 'GET', `/repos/${REPO}/commits/${ctx.cabeza}/check-runs?check_name=revisor`);
  const ultimo = checks.filter((c) => c.status === 'completed' && c.app?.slug === 'fabrica-revisor').sort((a, b) => b.id - a.id)[0];
  if (!ultimo) return console.log('anulación: aún no hay veredicto de la App sobre esta cabeza; lo aplicará el juicio en curso al terminar');
  if (ultimo.conclusion === 'success') return console.log('anulación: el check revisor ya está en verde; nada que hacer');
  const hallazgos = String(ultimo.output?.summary ?? '').split('\n').map((l) => l.replace(/^- /, '')).filter(Boolean);
  await publicarCheck(REPO, ctx.cabeza, TOKEN, 'success', { title: TITULO_ANULACION, summary: resumenAnulacion(aprobacion, ctx.cabeza, hallazgos) });
  console.log(TITULO_ANULACION);
}

async function main() {
  if (process.env.MODO === 'anulacion') {
    for (const k of ['REPO', 'PR', 'TOKEN']) if (!process.env[k]) throw new Error(`falta la variable ${k}`);
    return anular(process.env);
  }
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
    const resumen = errorEstandar ? answersSummary() : veredicto.respuestas;
    const estandar = (STANDARD ?? '').match(RUTA_ESTANDAR)?.[2] ?? null;
    registro = buildRecord({
      repo: REPO, pr: PR, sha: SHA, standard: estandar, veredicto,
      respuestas: resumen ?? answersSummary(),
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
