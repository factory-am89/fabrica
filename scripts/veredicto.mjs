// Convierte la salida del revisor en un veredicto y lo publica como la App
// fabrica-revisor: un check `revisor` y, si es sí, una aprobación.
// El veredicto lo calcula este código, no el modelo: falla en alto (cualquier
// hueco o duda es «no»). Variables: SALIDA, REPO, PR, SHA y TOKEN (token de la App).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RESPUESTAS = ['sí', 'no', 'no aplica'];

// Las preguntas salen de estandares/codigo.md: es su única fuente.
export function leerPreguntas(md) {
  const preguntas = [];
  const bloques = md.split(/^### /m).slice(1);
  for (const b of bloques) {
    const id = b.match(/^(C\d+) — (.+)$/m);
    const quien = b.match(/^Quién: (máquina|revisor)/m);
    if (!id || !quien) throw new Error(`pregunta mal formada: ${b.split('\n')[0]}`);
    preguntas.push({ id: id[1], pregunta: id[2], quien: quien[1] });
  }
  return preguntas;
}

function normalizar(r) {
  const t = String(r ?? '').trim().toLowerCase();
  return t === 'si' ? 'sí' : t;
}

// Los cambios al árbitro (el workflow, este script, el estándar y la configuración de
// Claude) no los aprueba una máquina que ellos mismos configuran: los aprueba Pablo.
const ARBITRO = /^(\.github\/|scripts\/veredicto\.mjs$|estandares\/|\.claude\/)/;
export const tocaArbitro = (ficheros) => ficheros.some((f) => ARBITRO.test(f));

// salida: texto JSON {respuestas:[{id, respuesta, prueba}]}
// ctx: { sha (el que se juzgó), cabeza (la cabeza actual del PR), ficheros (rutas del diff,
// con las anteriores si hubo renombrado), pablo (¿review aprobada de Pablo sobre ese SHA?) }
// Solo ids, respuestas y veredicto salen de aquí: ningún texto libre del modelo.
export function decidir(salida, preguntas, ctx = {}) {
  const fallos = [];
  if (!ctx.sha || ctx.sha !== ctx.cabeza) fallos.push('la cabeza del PR ya no es el SHA juzgado');
  let datos;
  try {
    datos = JSON.parse(salida);
  } catch {
    return { ok: false, fallos: [...fallos, 'salida ilegible'], arbitro: false };
  }
  const repetidos = new Set();
  const porId = new Map();
  for (const r of datos?.respuestas ?? []) {
    if (porId.has(r?.id)) repetidos.add(r.id);
    porId.set(r?.id, r);
  }
  for (const id of repetidos) fallos.push(`${id}: id repetido`);
  for (const p of preguntas.filter((q) => q.quien === 'revisor')) {
    const r = porId.get(p.id);
    const resp = normalizar(r?.respuesta);
    if (!r) fallos.push(`${p.id}: sin respuesta`);
    else if (!RESPUESTAS.includes(resp)) fallos.push(`${p.id}: respuesta no válida`);
    else if (resp === 'no') fallos.push(`${p.id}: no`);
    else if (!String(r.prueba ?? '').trim()) fallos.push(`${p.id}: sin prueba`);
  }
  const arbitro = tocaArbitro(ctx.ficheros ?? []);
  if (arbitro && !ctx.pablo) {
    fallos.push('no, requiere aprobación de Pablo: el diff toca el árbitro (.github/, scripts/veredicto.mjs, estandares/ o .claude/)');
  }
  return { ok: fallos.length === 0, fallos, arbitro };
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

async function todas(token, ruta) {
  const salida = [];
  for (let pagina = 1; ; pagina++) {
    const lote = await api(token, 'GET', `${ruta}?per_page=100&page=${pagina}`);
    salida.push(...lote);
    if (lote.length < 100) return salida;
  }
}

// ¿La última review de Pablo es una aprobación sobre este SHA? Una aprobación de otro commit no vale.
export function aprobadoPorPablo(reviews, sha) {
  const suyas = reviews.filter((r) => r.user?.login === 'pabloam89' && r.state !== 'COMMENTED' && r.state !== 'PENDING');
  const ultima = suyas.at(-1);
  return ultima?.state === 'APPROVED' && ultima.commit_id === sha;
}

async function leerContexto({ repo, pr, sha, token }) {
  const [datosPr, ficheros, reviews] = await Promise.all([
    api(token, 'GET', `/repos/${repo}/pulls/${pr}`),
    todas(token, `/repos/${repo}/pulls/${pr}/files`),
    todas(token, `/repos/${repo}/pulls/${pr}/reviews`),
  ]);
  return {
    sha,
    cabeza: datosPr.head.sha,
    ficheros: ficheros.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean)),
    pablo: aprobadoPorPablo(reviews, sha),
  };
}

async function publicar({ repo, pr, sha, token, veredicto, ctx }) {
  const titulo = veredicto.ok ? (veredicto.arbitro ? 'Veredicto: sí, aprobado por Pablo' : 'Veredicto: sí') : 'Veredicto: no';
  const texto = veredicto.fallos.map((f) => `- ${f}`).join('\n') || 'Todas las respuestas del revisor son sí o no aplica, con prueba.';
  await api(token, 'POST', `/repos/${repo}/check-runs`, {
    name: 'revisor',
    head_sha: sha,
    status: 'completed',
    conclusion: veredicto.ok ? 'success' : 'failure',
    output: { title: titulo, summary: texto },
  });
  // La aprobación de la App solo si el PR sigue en el SHA juzgado y no es un cambio al árbitro
  // (ahí la aprobación es la de Pablo, que ya existe).
  if (veredicto.ok && !veredicto.arbitro && ctx.sha === ctx.cabeza) {
    await api(token, 'POST', `/repos/${repo}/pulls/${pr}/reviews`, { commit_id: sha, event: 'APPROVE', body: 'Veredicto: sí.' });
  }
}

async function main() {
  const { SALIDA, REPO, PR, SHA, TOKEN } = process.env;
  for (const [k, v] of Object.entries({ REPO, PR, SHA, TOKEN })) {
    if (!v) throw new Error(`falta la variable ${k}`);
  }
  const md = readFileSync(new URL('../estandares/codigo.md', import.meta.url), 'utf8');
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
