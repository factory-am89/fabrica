// El paso «al-dia» del arranque: la carpeta principal avanza con `pull --ff-only` o no se toca y se dice por qué.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { alDia, pasoAlDia } from '../scripts/pull-main.mjs';
import { arrancar, PASOS } from '../scripts/al-arrancar.mjs';
import { decidir } from '../.claude/hooks/carpeta-principal.mjs';

const HOOKS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.githooks');
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const commit = (cwd, fichero, texto) => {
  writeFileSync(path.join(cwd, fichero), texto);
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-m', `${fichero} ${texto}`);
};

// origin (bare), una «otra» carpeta que publica y una principal clonada que se queda atrás.
function montar() {
  const raiz = realpathSync(mkdtempSync(path.join(tmpdir(), 'al-dia-')));
  const origin = path.join(raiz, 'origin.git');
  const otra = path.join(raiz, 'otra');
  const principal = path.join(raiz, 'principal');
  git(raiz, 'init', '--bare', '-b', 'main', origin);
  git(raiz, 'clone', origin, otra);
  commit(otra, 'a.txt', 'uno');
  git(otra, 'push', 'origin', 'HEAD:main');
  git(raiz, 'clone', origin, principal);
  git(principal, 'config', 'core.hooksPath', HOOKS); // los hooks de git que niegan la principal, activos de verdad
  return { principal, avanzaOrigin: (f, t) => { commit(otra, f, t); git(otra, 'push', 'origin', 'HEAD:main'); } };
}

test('al-dia: principal atrasada avanza hasta origin/main, con los hooks de git de la principal activos', () => {
  const { principal, avanzaOrigin } = montar();
  avanzaOrigin('b.txt', 'dos');
  const antes = git(principal, 'rev-parse', 'HEAD');
  const r = alDia(principal);
  assert.equal(r.ok, true);
  assert.notEqual(git(principal, 'rev-parse', 'HEAD'), antes);
  assert.equal(git(principal, 'rev-parse', 'HEAD'), git(principal, 'rev-parse', 'origin/main'));
});

test('al-dia: principal ya al día no cambia nada y no es un fallo', () => {
  const { principal } = montar();
  const antes = git(principal, 'rev-parse', 'HEAD');
  const r = alDia(principal);
  assert.equal(r.ok, true);
  assert.equal(git(principal, 'rev-parse', 'HEAD'), antes);
});

test('al-dia: con cambios sin guardar no toca nada y dice el motivo, aunque el pull habría podido avanzar', () => {
  const { principal, avanzaOrigin } = montar();
  avanzaOrigin('b.txt', 'dos');
  writeFileSync(path.join(principal, 'suelto.txt'), 'sin commit');
  const antes = git(principal, 'rev-parse', 'HEAD');
  const r = alDia(principal);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /cambios sin guardar/);
  assert.equal(git(principal, 'rev-parse', 'HEAD'), antes);
  assert.equal(git(principal, 'status', '--porcelain'), '?? suelto.txt');
});

test('al-dia: divergente (commit propio y otro en origin) no cambia nada y dice el motivo', () => {
  const { principal, avanzaOrigin } = montar();
  git(principal, 'config', '--unset', 'core.hooksPath'); // el commit propio es el estado de partida; los hooks vuelven antes del pull
  commit(principal, 'propio.txt', 'mio');
  git(principal, 'config', 'core.hooksPath', HOOKS);
  avanzaOrigin('b.txt', 'dos');
  const antes = git(principal, 'rev-parse', 'HEAD');
  const r = alDia(principal);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /fast-forward|divergen/i);
  assert.equal(git(principal, 'rev-parse', 'HEAD'), antes);
  assert.equal(git(principal, 'status', '--porcelain'), '');
});

test('al-dia: sin red (origin inalcanzable) no toca nada y dice el motivo', () => {
  const { principal } = montar();
  git(principal, 'remote', 'set-url', 'origin', path.join(principal, 'no-existe.git'));
  const antes = git(principal, 'rev-parse', 'HEAD');
  const r = alDia(principal);
  assert.equal(r.ok, false);
  assert.ok(r.motivo.length > 0);
  assert.equal(git(principal, 'rev-parse', 'HEAD'), antes);
});

test('al-dia: dentro del arranque, un fallo sale como titular del paso «al-dia» y el éxito no lo es', () => {
  const { principal, avanzaOrigin } = montar();
  const lineas = [];
  assert.equal(arrancar([pasoAlDia(() => alDia(principal))], (l) => lineas.push(l)), 0);
  assert.doesNotMatch(lineas.join(' | '), /FALLÓ/);
  avanzaOrigin('b.txt', 'dos');
  writeFileSync(path.join(principal, 'suelto.txt'), 'x');
  const fallo = [];
  assert.equal(arrancar([pasoAlDia(() => alDia(principal))], (l) => fallo.push(l)), 1);
  assert.match(fallo[0], /^FÁBRICA AL ARRANCAR: FALLÓ el paso «al-dia»: .*cambios sin guardar/);
});

test('al-dia: rama suelta (HEAD separado) no cambia nada y dice el motivo', () => {
  const { principal, avanzaOrigin } = montar();
  git(principal, 'checkout', '--detach');
  avanzaOrigin('b.txt', 'dos');
  const antes = git(principal, 'rev-parse', 'HEAD');
  const r = alDia(principal);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /not currently on a branch|no pudo avanzar/);
  assert.equal(git(principal, 'rev-parse', 'HEAD'), antes);
});

test('al-dia: PASOS lo incluye y el hook carpeta-principal deja pasar la orden `git pull --ff-only` a la principal', () => {
  assert.ok(PASOS.some((p) => p.nombre === 'al-dia'));
  const raiz = path.join(tmpdir(), 'hook-al-dia');
  const principal = path.join(raiz, 'fabrica');
  const carpetas = [principal, path.join(raiz, 'fabrica-x')];
  const entrada = (command) => ({ tool_name: 'Bash', tool_input: { command }, cwd: carpetas[1] });
  assert.equal(decidir(entrada(`git -C ${principal} pull --ff-only`), carpetas), null);
  assert.notEqual(decidir(entrada(`git -C ${principal} pull`), carpetas), null);
});
