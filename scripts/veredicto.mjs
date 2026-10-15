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

// salida: texto JSON {respuestas:[{id, respuesta, prueba}], resumen}
export function decidir(salida, preguntas) {
  let datos;
  try {
    datos = JSON.parse(salida);
  } catch {
    return { ok: false, resumen: 'El revisor no devolvió un JSON legible.', fallos: ['salida ilegible'] };
  }
  const fallos = [];
  const porId = new Map((datos?.respuestas ?? []).map((r) => [r.id, r]));
  for (const p of preguntas.filter((q) => q.quien === 'revisor')) {
    const r = porId.get(p.id);
    const resp = normalizar(r?.respuesta);
    if (!r) fallos.push(`${p.id}: sin respuesta`);
    else if (!RESPUESTAS.includes(resp)) fallos.push(`${p.id}: respuesta no válida «${r.respuesta}»`);
    else if (resp === 'no') fallos.push(`${p.id}: no — ${r.prueba ?? ''}`);
    else if (!String(r.prueba ?? '').trim()) fallos.push(`${p.id}: sin prueba`);
  }
  const resumen = String(datos?.resumen ?? '').slice(0, 2000);
  return { ok: fallos.length === 0, resumen, fallos };
}

async function api(token, metodo, ruta, cuerpo) {
  const res = await fetch(`https://api.github.com${ruta}`, {
    method: metodo,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify(cuerpo),
  });
  if (!res.ok) throw new Error(`${metodo} ${ruta} → ${res.status} ${await res.text()}`);
}

async function publicar({ repo, pr, sha, token, veredicto }) {
  const texto = [veredicto.resumen, ...veredicto.fallos.map((f) => `- ${f}`)].join('\n');
  await api(token, 'POST', `/repos/${repo}/check-runs`, {
    name: 'revisor',
    head_sha: sha,
    status: 'completed',
    conclusion: veredicto.ok ? 'success' : 'failure',
    output: { title: veredicto.ok ? 'Veredicto: sí' : 'Veredicto: no', summary: texto.slice(0, 60000) },
  });
  if (veredicto.ok) {
    await api(token, 'POST', `/repos/${repo}/pulls/${pr}/reviews`, {
      commit_id: sha,
      event: 'APPROVE',
      body: veredicto.resumen || 'Veredicto: sí.',
    });
  }
}

async function main() {
  const { SALIDA, REPO, PR, SHA, TOKEN } = process.env;
  for (const [k, v] of Object.entries({ REPO, PR, SHA, TOKEN })) {
    if (!v) throw new Error(`falta la variable ${k}`);
  }
  const md = readFileSync(new URL('../estandares/codigo.md', import.meta.url), 'utf8');
  const veredicto = decidir(SALIDA ?? '', leerPreguntas(md));
  await publicar({ repo: REPO, pr: PR, sha: SHA, token: TOKEN, veredicto });
  console.log(veredicto.ok ? 'veredicto: sí' : `veredicto: no\n${veredicto.fallos.join('\n')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
