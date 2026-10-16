// Precarga para el test del veredicto: sustituye fetch por una GitHub falsa. Responde lo que
// pediría el script (el PR, sus ficheros y sus reviews, REVIEWS_FALSAS; los check-runs del commit, CHECKS_FALSOS) y apunta lo que publica en stderr.
// COMPARE_FALSO: los ficheros del compare (por defecto, solo el workflow); CONTENIDOS_FALSOS: {"<ref>:<ruta>": texto} para /contents (lo que no está, 404).
// Un PR que toca el workflow del revisor, sin ninguna review de Pablo salvo que REVIEWS_FALSAS diga otra cosa. Una ruta que no conoce es un 404.
const { REPO, PR, SHA } = process.env;
const base = `/repos/${REPO}/pulls/${PR}`;
const compare = JSON.parse(process.env.COMPARE_FALSO ?? '[{"filename":".github/workflows/revisor.yml","status":"modified"}]');
const contenidos = JSON.parse(process.env.CONTENIDOS_FALSOS ?? '{}');
const respuestas = {
  [`GET ${base}`]: { head: { sha: SHA } },
  [`GET ${base}/files`]: [{ filename: '.github/workflows/revisor.yml', status: 'modified' }],
  [`GET ${base}/reviews`]: JSON.parse(process.env.REVIEWS_FALSAS ?? '[]'),
  [`GET /repos/${REPO}/commits/${SHA}/check-runs`]: { check_runs: JSON.parse(process.env.CHECKS_FALSOS ?? '[]') },
  [`POST /repos/${REPO}/check-runs`]: {},
  [`POST ${base}/reviews`]: {},
};

globalThis.fetch = async (url, opciones = {}) => {
  const metodo = opciones.method ?? 'GET';
  const { pathname: ruta, searchParams } = new URL(url);
  if (ruta.startsWith(`/repos/${REPO}/compare/`)) return new Response(JSON.stringify({ files: searchParams.get('page') === '1' ? compare : [] }), { status: 200 });
  if (ruta.startsWith(`/repos/${REPO}/contents/`)) {
    const texto = contenidos[`${searchParams.get('ref')}:${ruta.slice(`/repos/${REPO}/contents/`.length)}`];
    return texto === undefined ? new Response('no existe', { status: 404 }) : new Response(texto, { status: 200 });
  }
  const cuerpo = respuestas[`${metodo} ${ruta}`];
  if (metodo === 'POST') process.stderr.write(`PUBLICADO ${JSON.stringify({ ruta, cuerpo: JSON.parse(opciones.body) })}\n`);
  if (cuerpo === undefined) return new Response(`ruta no simulada: ${metodo} ${ruta}`, { status: 404 });
  return new Response(JSON.stringify(cuerpo), { status: 200 });
};
