// El arranque de sesión: un solo gancho en settings.json y un script con pasos que no se tapan entre sí.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arrancar, PASOS } from '../scripts/al-arrancar.mjs';

const ajustes = JSON.parse(readFileSync(new URL('../.claude/settings.json', import.meta.url), 'utf8'));

test('al-arrancar: un paso que falla se dice y no impide los demás', () => {
  const dicho = [];
  const ejecutados = [];
  const pasos = [
    { nombre: 'uno', ejecutar: () => { throw new Error('roto'); } },
    { nombre: 'dos', ejecutar: () => ejecutados.push('dos') },
  ];
  assert.equal(arrancar(pasos, (l) => dicho.push(l)), 1);
  assert.deepEqual(ejecutados, ['dos']);
  assert.match(dicho.join('\n'), /FALLÓ el paso «uno»: roto/);
});

test('al-arrancar: la limpieza es un paso', () => {
  assert.ok(PASOS.some((p) => p.nombre === 'limpiar'));
});

test('settings.json: SessionStart lanza solo scripts/al-arrancar.mjs', () => {
  const comandos = ajustes.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command));
  assert.deepEqual(comandos, ['node "$CLAUDE_PROJECT_DIR/scripts/al-arrancar.mjs"']);
});
