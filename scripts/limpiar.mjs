// Borra las carpetas de trabajo cuyo PR ya está fusionado en GitHub: npm run limpiar [-- --ensayo]
// La ascendencia no sirve (squash y rebase dejan la rama fuera de main): se mira el PR fusionado.
// Una sola consulta REST por pasada (los últimos 100 PR cerrados), por scripts/token.mjs. Si GitHub no
// responde, falla en alto y no borra nada. Lo que no se pudo borrar se dice siempre.
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, gitOk, norm, worktrees } from './lib/carpetas.mjs';
import { quitarUnion } from './retirar.mjs';
import { REPO } from './lib/repo.mjs';

const TOKEN = fileURLToPath(new URL('./token.mjs', import.meta.url));

// Lanza una orden con token de App (token.mjs es la única puerta); `token` es el script, para los tests.
function conToken(token, orden, cwd) {
  return spawnSync(process.execPath, [token, '--', ...orden], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// Los PR fusionados por la punta de su rama: sha → número. Un PR cerrado sin fusionar no cuenta.
export function prsFusionados(repo, token, cwd) {
  const r = conToken(token, ['gh', 'api', `repos/${repo}/pulls?state=closed&per_page=100`], cwd);
  if (r.error || r.status !== 0) throw new Error(`GitHub no responde (${r.error?.message ?? r.stderr.trim().split('\n')[0]}); no se borra nada.`);
  let lista;
  try {
    lista = JSON.parse(r.stdout);
  } catch {
    throw new Error('GitHub no responde con una lista de PR legible; no se borra nada.');
  }
  if (!Array.isArray(lista)) throw new Error('GitHub no responde con una lista de PR; no se borra nada.');
  return new Map(lista.filter((p) => p.merged_at && p.head?.sha).map((p) => [p.head.sha, p.number]));
}

// Ramas que existen hoy en origin (una sola pregunta). Sin esto no se sabe qué hay que borrar allí.
function ramasRemotas(cwd) {
  const r = git(['ls-remote', '--heads', 'origin'], cwd);
  if (r.status !== 0) throw new Error(`No pude listar las ramas de origin: ${r.stderr.trim()}; no se borra nada.`);
  return new Set(r.stdout.split('\n').filter(Boolean).map((l) => l.split('\trefs/heads/')[1]));
}

const dentro = (hijo, padre) => {
  const rel = path.relative(norm(padre), norm(hijo));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// Las demás carpetas cuyo node_modules es una unión que acaba dentro de esta: borrarla se lo llevaría.
function dependientes(carpeta, todas) {
  const nombres = [];
  for (const w of todas) {
    if (norm(w.ruta) === norm(carpeta)) continue;
    const nm = path.join(w.ruta, 'node_modules');
    let destino;
    try {
      if (!lstatSync(nm).isSymbolicLink()) continue;
      destino = realpathSync(nm);
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw new Error(`no pude mirar ${nm}: ${e.message}`);
    }
    if (dentro(destino, carpeta)) nombres.push(path.basename(w.ruta));
  }
  return nombres;
}

// Por qué una carpeta se queda, o null si se puede borrar. Lanza si no puede decidirlo.
function motivoDeQuedarse(w, principal, todas, fusionados, cwd) {
  if (!w.rama) return 'sin rama (cabeza suelta): decide a mano';
  if (dentro(cwd, w.ruta)) return 'estás dentro de ella';
  const punta = gitOk(['rev-parse', w.rama], principal);
  // Misma punta que el PR fusionado: todo lo de la rama está en GitHub (nada sin subir ni sin fusionar).
  if (!fusionados.has(punta)) return 'no hay un PR fusionado con la punta de esta rama (sin PR, o con commits tras la fusión)';
  const sucio = gitOk(['status', '--porcelain', '--', '.', ':(exclude)node_modules'], w.ruta);
  if (sucio) return `cambios sin guardar:\n${sucio}`;
  const otras = dependientes(w.ruta, todas);
  if (otras.length > 0) return `unión de node_modules de ${otras.join(', ')} apunta aquí; borrarla se lo llevaría`;
  return null;
}

function borrar(w, principal, remotas, token) {
  const hecho = { carpeta: w.ruta, rama: w.rama, union: false, remota: false, avisos: [] };
  hecho.union = quitarUnion(path.join(w.ruta, 'node_modules'));
  gitOk(['worktree', 'remove', w.ruta], principal);
  gitOk(['branch', '-D', w.rama], principal);
  if (remotas.has(w.rama)) {
    const r = conToken(token, ['git', 'push', 'origin', '--delete', w.rama], principal);
    if (r.status === 0) hecho.remota = true;
    else hecho.avisos.push(`no pude borrar la rama remota ${w.rama}: ${(r.error?.message ?? r.stderr).trim()}`);
  }
  return hecho;
}

export function limpiar({ cwd = process.cwd(), ensayo = false, token = TOKEN, repo = REPO } = {}) {
  const todas = worktrees(cwd);
  const principal = todas[0].ruta;
  const fusionados = prsFusionados(repo, token, principal);
  const remotas = ramasRemotas(principal);
  const salida = { ensayo, borradas: [], quedan: [], fallos: 0 };
  for (const w of todas.slice(1)) {
    const quedan = (motivo, fallo = false) => {
      salida.quedan.push({ carpeta: w.ruta, rama: w.rama, motivo });
      if (fallo) salida.fallos += 1;
    };
    try {
      const motivo = motivoDeQuedarse(w, principal, todas, fusionados, cwd);
      if (motivo) quedan(motivo);
      else if (ensayo) salida.borradas.push({ carpeta: w.ruta, rama: w.rama, remota: remotas.has(w.rama), avisos: [] });
      else {
        const hecho = borrar(w, principal, remotas, token);
        salida.borradas.push(hecho);
        salida.fallos += hecho.avisos.length;
      }
    } catch (e) {
      quedan(`no pude borrarla: ${e.message}`, true);
    }
  }
  return salida;
}

export function imprimir(s, escribir = console.log) {
  const verbo = s.ensayo ? 'borraría' : 'borrada';
  for (const b of s.borradas) {
    escribir(`limpiar ${verbo}: ${b.carpeta} (rama ${b.rama}${b.remota ? ', y su rama remota' : ''})`);
    for (const a of b.avisos) escribir(`limpiar AVISO: ${b.carpeta}: ${a}`);
  }
  for (const q of s.quedan) escribir(`limpiar se queda: ${q.carpeta} (${q.rama ?? 'sin rama'}): ${q.motivo}`);
  escribir(`limpiar resumen: ${s.borradas.length} ${s.ensayo ? 'a borrar' : 'borradas'}, ${s.quedan.length} se quedan, ${s.fallos} fallos`);
}

if (process.argv[1] === fileURLToPath(import.meta.url) && existsSync(process.argv[1])) {
  try {
    const s = limpiar({ ensayo: process.argv.includes('--ensayo') });
    imprimir(s);
    process.exit(s.fallos > 0 ? 1 : 0);
  } catch (e) {
    console.error(`limpiar: ${e.message}`);
    process.exit(1);
  }
}
