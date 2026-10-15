// Precarga para el test del veredicto: sustituye fetch por una GitHub falsa. Responde lo que
// pediría el script (el PR, sus ficheros y sus reviews) y apunta lo que publica en stderr.
// Un PR que toca el workflow del revisor, sin ninguna review de Pablo. Una ruta que no conoce es un 404.
const { REPO, PR, SHA } = process.env;
const base = `/repos/${REPO}/pulls/${PR}`;
const respuestas = {
  [`GET ${base}`]: { head: { sha: SHA } },
  [`GET ${base}/files`]: [{ filename: '.github/workflows/revisor.yml', status: 'modified' }],
  [`GET ${base}/reviews`]: [],
  [`POST /repos/${REPO}/check-runs`]: {},
  [`POST ${base}/reviews`]: {},
};

globalThis.fetch = async (url, opciones = {}) => {
  const metodo = opciones.method ?? 'GET';
  const ruta = new URL(url).pathname;
  const cuerpo = respuestas[`${metodo} ${ruta}`];
  if (metodo === 'POST') process.stderr.write(`PUBLICADO ${JSON.stringify({ ruta, cuerpo: JSON.parse(opciones.body) })}\n`);
  if (cuerpo === undefined) return new Response(`ruta no simulada: ${metodo} ${ruta}`, { status: 404 });
  return new Response(JSON.stringify(cuerpo), { status: 200 });
};
