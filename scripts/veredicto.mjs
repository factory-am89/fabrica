// Convierte la salida del revisor en un veredicto y lo publica como la App
// fabrica-revisor: un check `revisor` y, si es sí, una aprobación.
// El veredicto lo calcula este código, no el modelo: falla en alto (cualquier
// hueco o duda es «no»). Variables: SALIDA, REPO, PR, SHA y TOKEN (token de la App).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readQuestions } from './lib/questions.mjs';

const RESPUESTAS = ['sí', 'no', 'no aplica'];

// Las preguntas salen de standards/code.md (único lector: scripts/lib/questions.mjs). El juez solo conoce el prefijo C.
export function leerPreguntas(md) {
  return readQuestions(md).map((q) => ({ id: q.id, pregunta: q.text, quien: q.checkedBy }));
}

function normalizar(r) {
  const t = String(r ?? '').trim().toLowerCase();
  return t === 'si' ? 'sí' : t;
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
    return { ok: false, fallos: [...fallos, 'salida ilegible'] };
  }
  // Solo se aceptan ids C<número> que existan en la lista de preguntas; el resto se cuenta sin
  // escribirlo (lo que sale al check y al log nunca es texto del modelo).
  const conocidos = new Set(preguntas.map((q) => q.id));
  const repetidos = new Set();
  const porId = new Map();
  let desconocidos = 0;
  for (const r of Array.isArray(datos?.respuestas) ? datos.respuestas : []) {
    if (typeof r?.id !== 'string' || !/^C\d+$/.test(r.id) || !conocidos.has(r.id)) {
      desconocidos += 1;
      continue;
    }
    if (porId.has(r.id)) repetidos.add(r.id);
    porId.set(r.id, r);
  }
  for (const id of repetidos) fallos.push(`${id}: id repetido`);
  if (desconocidos) fallos.push(`${desconocidos} ids desconocidos`);
  for (const p of preguntas.filter((q) => q.quien === 'revisor')) {
    const r = porId.get(p.id);
    const resp = normalizar(r?.respuesta);
    if (!r) fallos.push(`${p.id}: sin respuesta`);
    else if (!RESPUESTAS.includes(resp)) fallos.push(`${p.id}: respuesta no válida`);
    else if (resp === 'no') fallos.push(`${p.id}: no`);
    else if (!String(r.prueba ?? '').trim()) fallos.push(`${p.id}: sin prueba`);
  }
  return { ok: fallos.length === 0, fallos };
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

async function publicar({ repo, pr, sha, token, veredicto, ctx }) {
  const titulo = veredicto.ok ? 'Veredicto: sí' : 'Veredicto: no';
  const texto = veredicto.fallos.map((f) => `- ${f}`).join('\n') || 'Todas las respuestas del revisor son sí o no aplica, con prueba.';
  await api(token, 'POST', `/repos/${repo}/check-runs`, {
    name: 'revisor',
    head_sha: sha,
    status: 'completed',
    conclusion: veredicto.ok ? 'success' : 'failure',
    output: { title: titulo, summary: texto },
  });
  // La aprobación de la App solo si el PR sigue en el SHA juzgado.
  if (veredicto.ok && ctx.sha === ctx.cabeza) {
    await api(token, 'POST', `/repos/${repo}/pulls/${pr}/reviews`, { commit_id: sha, event: 'APPROVE', body: 'Veredicto: sí.' });
  }
}

async function main() {
  const { SALIDA, REPO, PR, SHA, TOKEN } = process.env;
  for (const [k, v] of Object.entries({ REPO, PR, SHA, TOKEN })) {
    if (!v) throw new Error(`falta la variable ${k}`);
  }
  const md = readFileSync(new URL('../standards/code.md', import.meta.url), 'utf8');
  const ctx = await leerContexto({ repo: REPO, pr: PR, sha: SHA, token: TOKEN });
  const veredicto = decidir(SALIDA ?? '', leerPreguntas(md), ctx);
  await publicar({ repo: REPO, pr: PR, sha: SHA, token: TOKEN, veredicto, ctx });
  console.log(veredicto.ok ? 'veredicto: sí' : `veredicto: no\n${veredicto.fallos.join('\n')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
