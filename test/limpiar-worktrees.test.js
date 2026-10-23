// El hook de usuario limpiar-worktrees, por su entrada real (`node usuario/hooks/limpiar-worktrees.mjs --si --silencio`)
// con cwd en un clon temporal. En un repo con ficha (.fabrica.json) no toca git; sin ficha, borra el worktree fusionado.
// Todo ocurre dentro de carpetas temporales: nada se borra fuera de ellas.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { NOMBRE_FICHA } from '../scripts/lib/repo-card.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(RAIZ, 'usuario', 'hooks', 'limpiar-worktrees.mjs');
// El hook no toca worktrees bajo AppData/Local/Temp (son de scratchpads de otras sesiones), así que las carpetas del
// test van dentro del repo, en .limpiar-wt-* (ignorado por git) y se borran al acabar. Solo se borra lo que el test creó.
const bases = [];
after(() => { for (const b of bases) rmSync(b, { recursive: true, force: true }); });
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// Un clon con un worktree cuya rama ya está fusionada en origin/main, subida y limpia.
function escenario(conFicha) {
  const base = mkdtempSync(path.join(RAIZ, '.limpiar-wt-'));
  bases.push(base);
  const remoto = path.join(base, 'remoto.git');
  const clon = path.join(base, 'clon');
  const wt = path.join(base, 'wt');
  git(base, 'init', '-q', '--bare', '-b', 'main', remoto);
  git(base, 'clone', '-q', remoto, clon);
  for (const [k, v] of [['user.name', 't'], ['user.email', 't@t']]) git(clon, 'config', k, v);
  git(clon, 'checkout', '-q', '-b', 'main');
  writeFileSync(path.join(clon, 'a.txt'), 'a');
  git(clon, 'add', '.');
  git(clon, 'commit', '-qm', 'a');
  git(clon, 'push', '-q', '-u', 'origin', 'main');
  git(clon, 'worktree', 'add', '-q', '-b', 'feat/x', wt);
  writeFileSync(path.join(wt, 'b.txt'), 'b');
  git(wt, 'add', '.');
  git(wt, 'commit', '-qm', 'b');
  git(wt, 'push', '-q', '-u', 'origin', 'feat/x');
  git(clon, 'merge', '-q', '--ff-only', 'feat/x');
  git(clon, 'push', '-q', 'origin', 'main');
  if (conFicha) writeFileSync(path.join(clon, '.fabrica.json'), '{}');
  return { clon, wt };
}
const correr = (clon, ...extra) => spawnSync('node', [HOOK, '--si', '--silencio', ...extra], { cwd: clon, encoding: 'utf8' });

test('con ficha .fabrica.json no toca git: el worktree fusionado sigue y no hay FETCH_HEAD', () => {
  const { clon, wt } = escenario(true);
  const r = correr(clon);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(wt), 'el worktree sigue en disco');
  assert.ok(!existsSync(path.join(clon, '.git', 'FETCH_HEAD')), 'no se escribió FETCH_HEAD');
});

test('sin ficha borra el worktree fusionado (la regla no apaga el hook entero)', () => {
  const { clon, wt } = escenario(false);
  const r = correr(clon);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(wt), 'el worktree se borró');
});

test('el hook suelto escribe el nombre de la ficha igual que repo-card.mjs (no puede importarlo: se instala solo en ~/.claude/hooks)', () => {
  assert.ok(readFileSync(HOOK, 'utf8').includes(`join(raiz, "${NOMBRE_FICHA}")`));
});
