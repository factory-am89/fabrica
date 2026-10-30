// Precarga para el test del veredicto: sustituye fetch por una GitHub falsa. Responde lo que
// pediría el script (el PR, sus ficheros y sus reviews, REVIEWS_FALSAS; los check-runs del commit, CHECKS_FALSOS) y apunta lo que publica en stderr.
// COMPARE_FALSO: los ficheros del compare (por defecto, solo el workflow); CONTENIDOS_FALSOS: {"<ref>:<ruta>": texto} para /contents (lo que no está, 404).
// Check-runs: un POST crea y devuelve el id 4242; un PATCH a /check-runs/<id> cierra uno; el GET sin filter=all devuelve solo el último, como la API real.
// Un PR que toca el workflow del revisor, sin ninguna review de Pablo salvo que REVIEWS_FALSAS diga otra cosa. Una ruta que no conoce es un 404.
// AUTOR_FALSO: el login de quien abrió el PR (user.login); sin él, el PR no trae `user`.
const { REPO, PR, SHA, AUTOR_FALSO } = process.env;
const base = `/repos/${REPO}/pulls/${PR}`;
const compare = JSON.parse(process.env.COMPARE_FALSO ?? '[{"filename":".github/workflows/revisor.yml","status":"modified"}]');
const contenidos = JSON.parse(process.env.CONTENIDOS_FALSOS ?? '{}');
const checksDelCommit = JSON.parse(process.env.CHECKS_FALSOS ?? '[]');
const respuestas = {
  [`GET ${base}`]: { head: { sha: SHA }, ...(AUTOR_FALSO ? { user: { login: AUTOR_FALSO } } : {}) },
  [`GET ${base}/files`]: [{ filename: '.github/workflows/revisor.yml', status: 'modified' }],
  [`GET ${base}/reviews`]: JSON.parse(process.env.REVIEWS_FALSAS ?? '[]'),
  [`POST /repos/${REPO}/check-runs`]: { id: 4242 },
  [`POST ${base}/reviews`]: {},
};
const publicado = (ruta, metodo, opciones) => process.stderr.write(`PUBLICADO ${JSON.stringify({ ruta, metodo, cuerpo: JSON.parse(opciones.body) })}\n`);

globalThis.fetch = async (url, opciones = {}) => {
  const metodo = opciones.method ?? 'GET';
  const { pathname: ruta, searchParams } = new URL(url);
  if (ruta.startsWith(`/repos/${REPO}/compare/`)) return new Response(JSON.stringify({ files: searchParams.get('page') === '1' ? compare : [] }), { status: 200 });
  if (ruta.startsWith(`/repos/${REPO}/contents/`)) {
    const texto = contenidos[`${searchParams.get('ref')}:${ruta.slice(`/repos/${REPO}/contents/`.length)}`];
    return texto === undefined ? new Response('no existe', { status: 404 }) : new Response(texto, { status: 200 });
  }
  if (metodo === 'GET' && ruta === `/repos/${REPO}/commits/${SHA}/check-runs`) {
    const ultimo = checksDelCommit.reduce((a, b) => (a === undefined || b.id > a.id ? b : a), undefined);
    const devueltos = searchParams.get('filter') === 'all' ? checksDelCommit : ultimo === undefined ? [] : [ultimo];
    return new Response(JSON.stringify({ check_runs: devueltos }), { status: 200 });
  }
  if (metodo === 'PATCH' && new RegExp(`^/repos/${REPO}/check-runs/[1-9][0-9]*$`).test(ruta)) {
    publicado(ruta, metodo, opciones);
    return new Response('{}', { status: 200 });
  }
  const cuerpo = respuestas[`${metodo} ${ruta}`];
  if (metodo === 'POST') publicado(ruta, metodo, opciones);
  if (cuerpo === undefined) return new Response(`ruta no simulada: ${metodo} ${ruta}`, { status: 404 });
  return new Response(JSON.stringify(cuerpo), { status: 200 });
};
