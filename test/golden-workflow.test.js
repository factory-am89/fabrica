// .github/workflows/golden.yml: la pasada programada del revisor sobre el corpus. Lo que no se puede probar sin GitHub
// (que arranque de verdad) se deja a workflow_dispatch; aquí, las reglas que una máquina sí comprueba: cuándo corre,
// con qué permisos y secretos, en qué orden baja los esperados y que no falla por detección baja.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import yaml from 'js-yaml';
import { CORPUS } from '../scripts/golden.mjs';
import { DEFAULT_TRIALS, MAX_CALLS } from '../scripts/golden-run.mjs';
import { leer } from './support/factory.mjs';

const RUTA = '.github/workflows/golden.yml';
const texto = leer(RUTA);
const wf = yaml.load(texto);
const job = wf.jobs.medir;
const pasos = job.steps;
const indice = (f) => {
  const i = pasos.findIndex(f);
  assert.notEqual(i, -1, 'paso no encontrado');
  return i;
};
const recoger = () => indice((p) => /--phase collect/.test(p.run ?? ''));
const bajarEsperados = () => indice((p) => /git sparse-checkout disable/.test(p.run ?? ''));
const subida = () => pasos.find((p) => /^actions\/upload-artifact@/.test(p.uses ?? ''));

test('corre cada semana, al cambiar el juez en main y a mano; en ningún otro caso', () => {
  assert.deepEqual(Object.keys(wf.on).sort(), ['push', 'schedule', 'workflow_dispatch']);
  assert.equal(wf.on.schedule.length, 1);
  assert.match(wf.on.schedule[0].cron, /^\d+ \d+ \* \* \d$/, 'una vez por semana: minuto, hora y día de la semana fijos');
  assert.deepEqual(wf.on.push.branches, ['main']);
  assert.deepEqual(wf.on.push.paths, ['.claude/agents/revisor.md', 'standards/**', '.github/workflows/revisor.yml', 'scripts/veredicto.mjs']);
});

test('permisos mínimos, el environment del revisor y concurrencia con cancelación', () => {
  assert.deepEqual(wf.permissions, { contents: 'read' });
  assert.equal(job.permissions, undefined, 'el job no cambia los permisos del workflow');
  assert.equal(job.environment, 'revisor');
  assert.equal(wf.concurrency['cancel-in-progress'], true);
  assert.ok(wf.concurrency.group);
  assert.doesNotMatch(texto, /continue-on-error/);
});

test('el único secreto es el token de Claude del revisor, y solo lo ve el paso que llama a Claude', () => {
  assert.deepEqual([...new Set(texto.match(/secrets\.[A-Za-z_]+/g))], ['secrets.CLAUDE_CODE_OAUTH_TOKEN']);
  const conToken = pasos.filter((p) => JSON.stringify(p).includes('CLAUDE_CODE_OAUTH_TOKEN'));
  assert.equal(conToken.length, 1);
  assert.equal(conToken[0], pasos[recoger()]);
  assert.doesNotMatch(texto, /github\.token|GH_TOKEN|REVISOR_APP_KEY|REVISOR_CLIENT_ID/);
});

test('los esperados se bajan DESPUÉS del paso con Claude, y hasta entonces el checkout no los trae', () => {
  const checkout = pasos[0];
  assert.match(checkout.uses, /^actions\/checkout@/);
  assert.equal(checkout.with['sparse-checkout-cone-mode'], false);
  const patrones = checkout.with['sparse-checkout'].trim().split('\n').map((l) => l.trim());
  assert.deepEqual(patrones, ['/*', '!/test/fixtures/golden/review/expected.json']);
  assert.ok(recoger() < bajarEsperados(), 'expected.json en disco antes de que Claude acabe');
  assert.doesNotMatch(texto, /--trials/, 'los intentos salen de DEFAULT_TRIALS de golden-run.mjs, no se copian aquí');
  assert.ok(indice((p) => /--phase score/.test(p.run ?? '')) > bajarEsperados(), 'se puntúa antes de tener los esperados');
  assert.ok(indice((p) => /npm install --global @anthropic-ai\/claude-code@\d+\.\d+\.\d+/.test(p.run ?? '')) < recoger(), 'el claude, con versión fija, se instala antes de la pasada');
});

test('3 intentos por los casos del corpus caben en el tope de llamadas', () => {
  const casos = readdirSync(CORPUS, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
  assert.equal(DEFAULT_TRIALS, 3);
  assert.ok(casos * 3 <= MAX_CALLS, `${casos} casos x 3 intentos pasan de ${MAX_CALLS}`);
});

test('no hay suelo: no pasa --floor ni puntúa con golden.mjs; publica resumen y artefacto aunque falle', () => {
  assert.doesNotMatch(texto, /--floor|golden\.mjs/);
  const resumen = pasos.find((p) => /GITHUB_STEP_SUMMARY/.test(p.run ?? ''));
  assert.equal(resumen.if, 'always()');
  assert.equal(subida().if, 'always()');
  assert.equal(subida().with['if-no-files-found'], 'error');
});

test('lo que se sube es la carpeta de salida de la pasada, nunca el corpus', () => {
  assert.match(subida().with.path, /runner\.temp/);
  assert.doesNotMatch(texto, /path:.*fixtures/);
});
