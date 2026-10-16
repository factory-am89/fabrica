// Lo mismo que `token.mjs -- gh api <ruta>` pero SIN credencial: una lectura (GET) de un repo público.
// Es la identidad «ninguna» de la ficha. No lee ningún token ni 1Password; solo sirve para `gh api <ruta>`.
// Sin credencial GitHub limita a 60 consultas por hora y dirección: limpiar hace una por pasada.
import { fileURLToPath } from 'node:url';

export async function consultar(ruta, fetchFn = fetch) {
  const res = await fetchFn(`https://api.github.com/${ruta.replace(/^\/+/, '')}`, {
    headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'fabrica-limpiar' },
  });
  if (!res.ok) throw new Error(`GET ${ruta} → ${res.status}${res.status === 403 || res.status === 429 ? ' (¿límite de consultas sin credencial?)' : ''}`);
  return res.text();
}

// Los argumentos son los de token.mjs: `-- gh api <ruta>`; cualquier otra orden se rechaza.
export function rutaDe(argv) {
  const i = argv.indexOf('--');
  const [cmd, sub, ruta, ...resto] = i === -1 ? [] : argv.slice(i + 1);
  if (cmd !== 'gh' || sub !== 'api' || !ruta || resto.length) throw new Error('Sin credencial solo sé hacer: -- gh api <ruta>');
  return ruta;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(await consultar(rutaDe(process.argv.slice(2))));
  } catch (e) {
    console.error(`gh-publico: ${e.message}`);
    process.exit(1);
  }
}
