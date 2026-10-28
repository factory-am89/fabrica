// Un repo que llama al juez de la Fábrica le pasa SOLO los tres secretos que el juez usa, uno a uno y por su nombre;
// nunca `secrets: inherit` (entregaría a un workflow de otro repo todos los secretos del llamador). Y el juez no deja que
// Claude cargue la configuración de proyecto de la copia del repo llamador (hooks, CLAUDE.md, .mcp.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { leer } from './apoyo/fabrica.mjs';

const TRES = ['CLAUDE_CODE_OAUTH_TOKEN', 'REVISOR_APP_KEY', 'REVISOR_CLIENT_ID'];
const DOS = ['REVISOR_APP_KEY', 'REVISOR_CLIENT_ID'];

// Todo fichero que un repo llamador copia o que lo documenta: workflows de la Fábrica y plantillas de proyecto nuevo.
const FICHEROS = [
  ...readdirSync(new URL('../.github/workflows/', import.meta.url)).map((f) => `.github/workflows/${f}`),
  ...readdirSync(new URL('../apps/proyecto-nuevo/', import.meta.url)).map((f) => `apps/proyecto-nuevo/${f}`),
];

test('ningún workflow ni plantilla de la Fábrica usa ni recomienda `secrets: inherit`', () => {
  for (const f of FICHEROS) assert.doesNotMatch(leer(f), /secrets:\s*inherit/, `${f} entrega todos los secretos del llamador`);
});

test('la plantilla del llamador pasa los tres secretos del juez por nombre y ninguno más', () => {
  const llamador = yaml.load(leer('apps/proyecto-nuevo/revisor.yml')).jobs.revisor;
  assert.deepEqual(Object.keys(llamador.secrets ?? {}).sort(), TRES);
  for (const n of TRES) assert.equal(llamador.secrets[n], `\${{ secrets.${n} }}`, n);
});

test('el juez y la anulación declaran como obligatorios exactamente los secretos que usan', () => {
  const sec = (f) => yaml.load(leer(f)).on.workflow_call.secrets;
  const juez = sec('.github/workflows/revisor.yml');
  assert.deepEqual(Object.keys(juez).sort(), TRES);
  const anulacion = sec('.github/workflows/anulacion.yml');
  assert.deepEqual(Object.keys(anulacion).sort(), DOS);
  for (const s of [...Object.values(juez), ...Object.values(anulacion)]) assert.equal(s.required, true);
});

test('el juez falla en alto con el nombre del secreto que llega vacío', () => {
  const paso = yaml.load(leer('.github/workflows/revisor.yml')).jobs.juzgar.steps.find((p) => p.name === 'Comprobar secretos');
  assert.ok(paso, 'falta el paso «Comprobar secretos» en juzgar');
  assert.deepEqual(Object.keys(paso.env).sort(), TRES);
  // El script del paso, ejecutado de verdad con bash (el shell del runner) con cada secreto vacío, uno a uno.
  for (const vacio of TRES) {
    const env = { ...process.env, ...Object.fromEntries(TRES.map((n) => [n, n === vacio ? '' : 'valor'])) };
    const r = spawnSync('bash', ['-c', paso.run], { env, encoding: 'utf8' });
    assert.equal(r.status, 1, `con ${vacio} vacío el paso debe salir con 1: ${r.stdout}${r.stderr}`);
    assert.ok(r.stdout.includes(vacio), `el error no nombra ${vacio}: ${r.stdout}`);
    for (const otro of TRES.filter((n) => n !== vacio)) assert.ok(!r.stdout.includes(otro), `el error nombra ${otro}, que sí llegó`);
  }
  const bien = spawnSync('bash', ['-c', paso.run], { env: { ...process.env, ...Object.fromEntries(TRES.map((n) => [n, 'valor'])) }, encoding: 'utf8' });
  assert.equal(bien.status, 0, `con los tres presentes no debe fallar: ${bien.stdout}${bien.stderr}`);
});

test('Claude solo carga la configuración de usuario, no la del proyecto que se juzga', () => {
  const paso = yaml.load(leer('.github/workflows/revisor.yml')).jobs.juzgar.steps.find((p) => p.id === 'claude');
  assert.match(paso.with.claude_args, /--setting-sources user(\s|$)/);
});
