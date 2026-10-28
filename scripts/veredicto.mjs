// Convierte la salida del revisor en un veredicto y lo publica como la App
// fabrica-revisor: un check `revisor` y, si es sí, una aprobación.
// El veredicto lo calcula este código, no el modelo: falla en alto (cualquier
// hueco o duda es «no»). Variables: SALIDA, REPO, PR, SHA, TOKEN (token de la App), CHECK_RUN (el check en curso que cierra) y STANDARD
// (obligatoria, sin valor por defecto: la ruta del estándar, p. ej. .fabrica/standards/code.md).
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKED_BY, ID_SOURCE, readQuestions } from './lib/questions.mjs';
import { checkGolden } from './lib/golden-guard.mjs';
import { OWNER_LOGIN, REVISOR_APP_SLUG, REPO as REPO_FABRICA } from './lib/repo.mjs';
import { ANSWER, ANSWERS, CUT_TITLE, ERROR, OVERRIDE_TITLE as TITULO_ANULACION, PENDING_TITLE, STANDARD_SOURCE, answersSummary, buildRecord, formatBlock, runFromEnv } from './lib/record.mjs';

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
// ctx: { sha (el que se juzgó), cabeza (la cabeza actual del PR), golden (motivos cerrados del freno del corpus dorado, scripts/lib/golden-guard.mjs; vacío o ausente = ninguno) }
// Solo ids, respuestas y veredicto salen de aquí: ningún texto libre del modelo.
export function decidir(salida, preguntas, ctx = {}) {
  const fallos = [];
  if (!ctx.sha || ctx.sha !== ctx.cabeza) fallos.push('la cabeza del PR ya no es el SHA juzgado');
  fallos.push(...(ctx.golden ?? []));
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
  if (!Array.isArray(reviews)) throw new Error('reviews: la API no devolvió una lista');
  const suyas = reviews.filter(
    (r) => typeof r?.user?.login === 'string' && r.user.login.toLowerCase() === dueno.toLowerCase() && DECISIVAS.includes(r.state)
  );
  const ultima = suyas.at(-1);
  return ultima?.state === 'APPROVED' && ultima.commit_id === cabeza ? ultima : null;
}

// Resumen del check de anulación: quién, sobre qué cabeza y qué hallazgos del revisor se anulan.
export function resumenAnulacion(review, cabeza, hallazgos) {
  if (hallazgos.length === 0) throw new Error('resumenAnulacion: sin hallazgos que anular');
  const lista = hallazgos.map((f) => `- ${f}`).join('\n');
  return `Anulado por la aprobación de ${review.user.login} (review ${review.id}) sobre ${cabeza}.\nHallazgos que se anulan:\n${lista}`;
}

async function reviewsDe({ repo, pr, token }) {
  const todas = [];
  for (let pagina = 1; ; pagina += 1) {
    const lote = await api(token, 'GET', `/repos/${repo}/pulls/${pr}/reviews?per_page=100&page=${pagina}`);
    if (!Array.isArray(lote)) throw new Error(`reviews: la página ${pagina} no es una lista`);
    todas.push(...lote);
    if (lote.length < 100) return todas;
  }
}

async function leerContexto({ repo, pr, sha, token }) {
  const datosPr = await api(token, 'GET', `/repos/${repo}/pulls/${pr}`);
  return { sha, cabeza: datosPr.head.sha, reviews: await reviewsDe({ repo, pr, token }) };
}

// El freno del corpus dorado: lee el PR por la API con el token de solo lectura del workflow (LECTOR; el de la App no tiene
// contents) y no ejecuta nada del PR. Devuelve los motivos cerrados de scripts/lib/golden-guard.mjs.
async function frenoDorado({ repo, base, sha, token }) {
  const get = async (ruta, accept) => {
    const res = await fetch(`https://api.github.com${ruta}`, { headers: { authorization: `Bearer ${token}`, accept, 'x-github-api-version': '2022-11-28' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${ruta} → ${res.status}`);
    return res;
  };
  return checkGolden({
    base,
    head: sha,
    listFiles: async () => {
      const todos = [];
      for (let pagina = 1; ; pagina += 1) {
        const res = await get(`/repos/${repo}/compare/${base}...${sha}?per_page=100&page=${pagina}`, 'application/vnd.github+json');
        if (!res) throw new Error('compare not found');
        const { files } = await res.json();
        if (!Array.isArray(files)) throw new Error('the compare has no file list');
        todos.push(...files);
        if (files.length < 100) return todos;
      }
    },
    read: async (ref, ruta) => {
      const res = await get(`/repos/${repo}/contents/${ruta}?ref=${ref}`, 'application/vnd.github.raw+json');
      return res ? res.text() : null;
    },
  });
}

const publicarCheck = (repo, sha, token, conclusion, output) =>
  api(token, 'POST', `/repos/${repo}/check-runs`, { name: 'revisor', head_sha: sha, status: 'completed', conclusion, output });

// El juicio en curso: el check `revisor` nace «in_progress» con PENDING_TITLE al empezar (MODO=pendiente) y el veredicto cierra ESE
// check con un PATCH. Mientras está en curso GitHub no deja fusionar con un verde viejo de la misma cabeza (check obligatorio sin terminar).
// external_id (campo propio de los check-runs de GitHub) lleva el run que lo abrió: MODO=cerrar encuentra por él el check de ESE run.
const marcarEnCurso = (repo, sha, token, runId) =>
  api(token, 'POST', `/repos/${repo}/check-runs`, { name: 'revisor', head_sha: sha, external_id: String(runId), status: 'in_progress', output: { title: PENDING_TITLE, summary: 'El revisor está juzgando esta cabeza.' } });
const cerrarCheck = (repo, checkRun, token, conclusion, output) =>
  api(token, 'PATCH', `/repos/${repo}/check-runs/${checkRun}`, { status: 'completed', conclusion, output });
const ID_DE_CHECK = /^[1-9]\d*$/;
const FALLO_SIN_MARCA = 'no se pudo marcar el juicio en curso';
export const TITULO = { yes: 'Veredicto: sí', no: 'Veredicto: no' };
const FALLO_SIN_VEREDICTO = 'el juez falló antes de dar veredicto';
const FALLO_JUICIO_MAS_NUEVO = 'hay un juicio más nuevo de esta cabeza';

// Todo lo que filtra por App (anulación, juicio y `cerrar`) cuenta solo los check de la App del repo que llama (REVISOR_APP_SLUG, lo
// pasan los workflows). Sin él no se sabe qué App es y se lanza; solo en la propia Fábrica vale la constante de repo.mjs.
function slugDeLaApp(repo) {
  const slug = process.env.REVISOR_APP_SLUG?.trim();
  if (slug) return slug;
  if (repo === REPO_FABRICA) return REVISOR_APP_SLUG;
  throw new Error(`REVISOR_APP_SLUG falta: no se sabe de qué App son los check \`revisor\` de ${repo}`);
}

// Todos los check `revisor` de una cabeza publicados por la App, del más nuevo al más viejo, de cualquier estado.
// filter=all: sin él la API devuelve solo el último de cada nombre.
async function revisoresDeLaApp(repo, sha, token) {
  const slug = slugDeLaApp(repo);
  const { check_runs: checks } = await api(token, 'GET', `/repos/${repo}/commits/${sha}/check-runs?check_name=revisor&filter=all&per_page=100`);
  if (!Array.isArray(checks)) throw new Error('check-runs: la API no devolvió una lista');
  return checks.filter((c) => c.app?.slug === slug).sort((a, b) => b.id - a.id);
}

// The record is one JSON line in a ```json block of output.text; title and summary are the ones decidir's veredicto gives.
async function publicar({ repo, pr, sha, token, veredicto, ctx, registro, checkRun, estado }) {
  const titulo = veredicto.ok ? TITULO.yes : TITULO.no;
  const texto = veredicto.fallos.map((f) => `- ${f}`).join('\n') || 'Todas las respuestas del revisor son sí o no aplica, con prueba.';
  await cerrarCheck(repo, checkRun, token, veredicto.ok ? 'success' : 'failure', { title: titulo, summary: texto, ...(registro ? { text: formatBlock(registro) } : {}) });
  estado.cerrado = true;
  // Si Pablo aprobó esta cabeza, el «no» (ya publicado, con su registro) queda anulado por un segundo check, el último.
  const aprobacion = !veredicto.ok && ctx.sha === ctx.cabeza ? aprobacionDePablo(ctx.reviews, ctx.cabeza) : null;
  if (aprobacion) await publicarCheck(repo, sha, token, 'success', { title: TITULO_ANULACION, summary: resumenAnulacion(aprobacion, sha, veredicto.fallos) });
  // La aprobación de la App solo si el PR sigue en el SHA juzgado.
  if (veredicto.ok && ctx.sha === ctx.cabeza) {
    await api(token, 'POST', `/repos/${repo}/pulls/${pr}/reviews`, { commit_id: sha, event: 'APPROVE', body: `${TITULO.yes}.` });
  }
}

// MODO=anulacion (lo lanza anulacion.yml tras una review): sin modelo. Solo si Pablo aprobó la cabeza actual y el
// último check `revisor` de esa cabeza (de cualquier estado), publicado por la App, está completado y no en verde, publica el check de anulación; si está en curso espera: lo aplica el juicio al terminar.
async function anular({ REPO, PR, TOKEN }) {
  const ctx = await leerContexto({ repo: REPO, pr: PR, sha: null, token: TOKEN });
  const aprobacion = aprobacionDePablo(ctx.reviews, ctx.cabeza);
  if (!aprobacion) return console.log('anulación: no hay aprobación de Pablo sobre la cabeza actual; nada que hacer');
  const ultimo = (await revisoresDeLaApp(REPO, ctx.cabeza, TOKEN))[0];
  if (!ultimo) return console.log('anulación: aún no hay veredicto de la App sobre esta cabeza; lo aplicará el juicio en curso al terminar');
  if (ultimo.status !== 'completed') return console.log('anulación: hay un juicio en curso sobre esta cabeza; lo aplicará al terminar');
  if (ultimo.conclusion === 'success') return console.log('anulación: el check revisor ya está en verde; nada que hacer');
  if (typeof ultimo.output?.summary !== 'string' || !ultimo.output.summary.trim()) throw new Error(`el check revisor ${ultimo.id} no trae resumen: no se sabe qué hallazgos se anulan`);
  const hallazgos = ultimo.output.summary.split('\n').map((l) => l.replace(/^- /, '')).filter(Boolean);
  await publicarCheck(REPO, ctx.cabeza, TOKEN, 'success', { title: TITULO_ANULACION, summary: resumenAnulacion(aprobacion, ctx.cabeza, hallazgos) });
  console.log(TITULO_ANULACION);
}

// MODO=pendiente (primer trabajo de revisor.yml, con su propio token de la App: Claude nunca lo ve): publica `revisor` en curso y deja
// su id como salida del paso (GITHUB_OUTPUT) para que el veredicto cierre ESE check.
async function pendiente({ REPO, SHA, TOKEN, GITHUB_OUTPUT, RUN_ID }) {
  const creado = await marcarEnCurso(REPO, SHA, TOKEN, RUN_ID);
  if (!ID_DE_CHECK.test(String(creado?.id))) throw new Error('la API no devolvió el id del check en curso');
  appendFileSync(GITHUB_OUTPUT, `check_run=${creado.id}\n`);
  console.log(`${PENDING_TITLE}: check ${creado.id}`);
}

// MODO=cerrar (tercer trabajo de revisor.yml, corre aunque se cancele el run, con su propio token de la App): si juzgar no llegó al
// veredicto, cierra en failure (CUT_TITLE: no en neutral, que un check obligatorio cuenta como pasado) los «juzgando» de ESE run.
async function cerrar({ REPO, SHA, TOKEN, RUN_ID }) {
  const abiertos = (await revisoresDeLaApp(REPO, SHA, TOKEN)).filter((c) => c.status !== 'completed' && c.external_id === RUN_ID);
  if (abiertos.length === 0) return console.log(`cerrar: nada que cerrar del run ${RUN_ID}`);
  for (const c of abiertos) {
    await cerrarCheck(REPO, c.id, TOKEN, 'failure', { title: CUT_TITLE, summary: `- el juicio se cortó antes del veredicto (run ${RUN_ID})` });
    console.log(`${CUT_TITLE}: check ${c.id}`);
  }
}

async function main() {
  if (process.env.MODO === 'anulacion') {
    for (const k of ['REPO', 'PR', 'TOKEN']) if (!process.env[k]) throw new Error(`falta la variable ${k}`);
    return anular(process.env);
  }
  if (process.env.MODO === 'pendiente') {
    for (const k of ['REPO', 'SHA', 'TOKEN', 'GITHUB_OUTPUT', 'RUN_ID']) if (!process.env[k]) throw new Error(`falta la variable ${k}`);
    return pendiente(process.env);
  }
  if (process.env.MODO === 'cerrar') {
    for (const k of ['REPO', 'SHA', 'TOKEN', 'RUN_ID']) if (!process.env[k]) throw new Error(`falta la variable ${k}`);
    return cerrar(process.env);
  }
  const { REPO, PR, SHA, TOKEN, BASE, LECTOR, CHECK_RUN } = process.env;
  for (const [k, v] of Object.entries({ REPO, PR, SHA, TOKEN, BASE, LECTOR })) {
    if (!v) throw new Error(`falta la variable ${k}`);
  }
  // Sin el check que abrió el trabajo `pendiente` no hay nada que cerrar: es un no publicado (nunca un sí ni un POST completado en silencio) y error.
  if (!ID_DE_CHECK.test(CHECK_RUN ?? '')) {
    await publicarCheck(REPO, SHA, TOKEN, 'failure', { title: TITULO.no, summary: `- ${FALLO_SIN_MARCA}` });
    throw new Error(`falta la variable CHECK_RUN (${FALLO_SIN_MARCA}): se publicó un no`);
  }
  // Un fallo antes de cerrar el check (la API, el freno dorado...) no puede dejarlo «juzgando» para siempre: la anulación de Pablo
  // espera a un juicio en curso y no actuaría. Se cierra en failure y se relanza el error. Si el veredicto ya lo cerró, no se toca.
  const estado = { cerrado: false };
  try {
    await juzgarPr(process.env, estado);
  } catch (e) {
    if (!estado.cerrado) {
      try {
        await cerrarCheck(REPO, CHECK_RUN, TOKEN, 'failure', { title: TITULO.no, summary: `- ${FALLO_SIN_VEREDICTO}` });
      } catch (e2) {
        console.error(`no se pudo cerrar el check ${CHECK_RUN}: ${e2.message}`);
      }
    }
    throw e;
  }
}

async function juzgarPr({ SALIDA, REPO, PR, SHA, TOKEN, STANDARD, BASE, LECTOR, CHECK_RUN }, estado) {
  const ctx = await leerContexto({ repo: REPO, pr: PR, sha: SHA, token: TOKEN });
  ctx.golden = await frenoDorado({ repo: REPO, base: BASE, sha: SHA, token: LECTOR });
  let preguntas;
  let errorEstandar = null;
  try {
    preguntas = cargarPreguntas(STANDARD);
  } catch (e) {
    errorEstandar = e;
  }
  // Un estándar inválido es un no publicado (nunca un sí) y el script sale con error.
  let veredicto = errorEstandar ? { ok: false, fallos: ['el estándar no se pudo cargar', ...ctx.golden] } : decidir(SALIDA ?? '', preguntas, ctx);
  // Un run viejo (cancelado, o relanzado) aún publica: un sí solo cierra en verde si la App no abrió otro `revisor` más nuevo en esta cabeza.
  if (veredicto.ok && (await revisoresDeLaApp(REPO, SHA, TOKEN)).some((c) => c.id > Number(CHECK_RUN) && c.output?.title !== TITULO_ANULACION)) {
    veredicto = { ...veredicto, ok: false, fallos: [...veredicto.fallos, FALLO_JUICIO_MAS_NUEVO] };
  }
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
  await publicar({ repo: REPO, pr: PR, sha: SHA, token: TOKEN, veredicto, ctx, registro, checkRun: CHECK_RUN, estado });
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
