// Un workflow reutilizable de la Fábrica lo llaman repos que fijan @main y no pueden cambiar su llamada de un día para otro
// (homenu-panel: pull_request_target corre SU workflow de main y su ruleset no tiene excepciones). Por eso una entrada
// `required: true` sin `default` solo vale si TODOS los llamadores conocidos de ese workflow ya la pasan. #182 hizo
// obligatoria `revisor-app-slug` y dejó a homenu-panel en startup_failure (run 40755774295).
//
// Regla para entradas nuevas de un workflow reutilizable: llevan `default`; o, si de verdad deben ser obligatorias, el PR
// explica cómo se actualiza cada llamador y esa entrada se apunta aquí en `pasa` de cada uno (cuando ya la pasan).
// Falta por hacer: la lista es a mano; no descubre llamadores en otros repos (solo `gh` podría) ni mira los secretos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import yaml from 'js-yaml';
import { leer } from './apoyo/fabrica.mjs';

// Lista cerrada. `pasa`: las entradas que su llamada pasa hoy en la rama que la Fábrica llama (@main).
export const LLAMADORES_CONOCIDOS = [
  { llamador: 'factory-am89/homenu-panel @main (.github/workflows/revisor.yml)', workflow: 'revisor.yml', pasa: [] },
  { llamador: 'plantilla apps/proyecto-nuevo/revisor.yml', workflow: 'revisor.yml', pasa: ['revisor-app-slug'] },
];

// Entradas obligatorias sin valor por defecto de cada workflow reutilizable, leídas de los ficheros.
export function obligatoriasSinDefault(ficheros = readdirSync(new URL('../.github/workflows/', import.meta.url))) {
  const salida = [];
  for (const f of ficheros) {
    const doc = yaml.load(leer(`.github/workflows/${f}`));
    const inputs = (doc.on ?? doc[true])?.workflow_call?.inputs ?? {};
    for (const [nombre, def] of Object.entries(inputs)) {
      if (def.required === true && def.default === undefined) salida.push({ workflow: f, nombre });
    }
  }
  return salida;
}

// Las entradas obligatorias sin default que dejan sin funcionar a algún llamador conocido.
export function rompen(obligatorias, llamadores = LLAMADORES_CONOCIDOS) {
  return obligatorias.flatMap(({ workflow, nombre }) =>
    llamadores.filter((l) => l.workflow === workflow && !l.pasa.includes(nombre)).map((l) => `${workflow}: «${nombre}» obligatoria sin default y ${l.llamador} no la pasa`));
}

test('ninguna entrada obligatoria sin default de un workflow reutilizable rompe a un llamador conocido', () => {
  assert.deepEqual(rompen(obligatoriasSinDefault()), []);
});

test('el detector ve el caso de #182: revisor-app-slug obligatoria sin default rompe a homenu-panel', () => {
  const r = rompen([{ workflow: 'revisor.yml', nombre: 'revisor-app-slug' }]);
  assert.equal(r.length, 1);
  assert.match(r[0], /homenu-panel/);
  assert.deepEqual(rompen([{ workflow: 'revisor.yml', nombre: 'revisor-app-slug' }], [{ llamador: 'x', workflow: 'revisor.yml', pasa: ['revisor-app-slug'] }]), []);
});

test('la lista de llamadores apunta a workflows reutilizables que existen, y la plantilla pasa lo que dice pasar', () => {
  for (const l of LLAMADORES_CONOCIDOS) {
    assert.ok(yaml.load(leer(`.github/workflows/${l.workflow}`)).on.workflow_call, `${l.workflow} ya no es reutilizable`);
  }
  const plantilla = yaml.load(leer('apps/proyecto-nuevo/revisor.yml')).jobs.revisor.with ?? {};
  const conocida = LLAMADORES_CONOCIDOS.find((l) => l.llamador.startsWith('plantilla'));
  assert.deepEqual(Object.keys(plantilla).sort(), [...conocida.pasa].sort());
});
