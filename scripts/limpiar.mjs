// Borra las carpetas de trabajo cuyo PR ya está fusionado en GitHub: npm run limpiar [-- --ensayo]
// La ascendencia no sirve (squash y rebase dejan la rama fuera de main): se mira el PR fusionado.
// Una sola consulta REST por pasada (los últimos 100 PR cerrados), por scripts/token.mjs. Si GitHub no
// responde, falla en alto y no borra nada. Lo que no se pudo borrar se dice siempre.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, gitOk, worktrees } from './lib/carpetas.mjs';
import { quitarUnion } from './retirar.mjs';
import { REPO } from './lib/repo.mjs';
import { TOKEN, conToken, motivoDeQuedarse, prsFusionados } from './lib/puede-borrarse.mjs';

// Por qué una carpeta se queda, o null si se puede borrar: la regla común, con solo PR fusionado como prueba.
const motivoDe = (w, todas, fusionados, cwd) => motivoDeQuedarse(w, { todas, cwd, fusionada: (punta) => fusionados.has(punta) });


// Ramas que existen hoy en origin (una sola pregunta). Sin esto no se sabe qué hay que borrar allí.
function ramasRemotas(cwd) {
  const r = git(['ls-remote', '--heads', 'origin'], cwd);
  if (r.status !== 0) throw new Error(`No pude listar las ramas de origin: ${r.stderr.trim()}; no se borra nada.`);
  return new Set(r.stdout.split('\n').filter(Boolean).map((l) => l.split('\trefs/heads/')[1]));
}

// Borra una carpeta paso a paso y cuenta lo que pasó de verdad. Lanza solo si NO llegó a borrar la carpeta
// (con el texto de lo que ya se había hecho); después de borrarla, un paso que falla es un aviso, no «se queda».
function borrar(w, principal, remotas, token) {
  const hecho = { carpeta: w.ruta, rama: w.rama, union: false, remota: false, avisos: [] };
  try {
    hecho.union = quitarUnion(path.join(w.ruta, 'node_modules'));
    gitOk(['worktree', 'remove', w.ruta], principal);
  } catch (e) {
    throw new Error(`${e.message}${hecho.union ? ' (la unión de node_modules ya estaba quitada)' : ''}`);
  }
  try {
    gitOk(['branch', '-D', w.rama], principal);
  } catch (e) {
    hecho.avisos.push(`la carpeta se borró, pero no pude borrar la rama local ${w.rama}: ${e.message}`);
  }
  if (remotas.has(w.rama)) {
    const r = conToken(token, ['git', 'push', 'origin', '--delete', w.rama], principal);
    if (r.status === 0) hecho.remota = true;
    else hecho.avisos.push(`la carpeta se borró, pero no pude borrar la rama remota ${w.rama}: ${(r.error?.message ?? r.stderr).trim()}`);
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
      const motivo = motivoDe(w, todas, fusionados, cwd);
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
