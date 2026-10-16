// Reglas de máquina sobre los workflows de un repo (C4 y que parseen), en un solo sitio.
// Comprueban la propia Fábrica y, con FABRICA_REPO_A_COMPROBAR=<carpeta>, el repo que llama a
// tests.yml (sin «no aplica»): el workflow reutilizable lo lanza apuntando a la carpeta del llamador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { accionFijada, accionesDe } from '../scripts/lib/actions.mjs';

// Una variable puesta pero vacía es un error, no «la Fábrica»: no se sustituye en silencio.
const RAIZ = process.env.FABRICA_REPO_A_COMPROBAR === undefined
  ? path.resolve(import.meta.dirname, '..')
  : path.resolve(process.env.FABRICA_REPO_A_COMPROBAR || assert.fail('FABRICA_REPO_A_COMPROBAR está vacía'));
const DIR = path.join(RAIZ, '.github', 'workflows');
const ficheros = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));

test('hay workflows que vigilar', () => assert.ok(ficheros.length > 0));

for (const f of ficheros) {
  const texto = readFileSync(path.join(DIR, f), 'utf8');

  test(`workflow ${f}: es YAML válido con jobs`, () => {
    const doc = yaml.load(texto);
    assert.equal(typeof doc, 'object');
    assert.ok(doc.jobs && Object.keys(doc.jobs).length > 0, 'sin jobs');
  });

  test(`workflow ${f}: declara permisos y fija cada acción por SHA (C4)`, () => {
    assert.match(texto, /^permissions:/m, `${f} sin permissions`);
    assert.doesNotMatch(texto, /permissions:\s*write-all/, `${f} con write-all`);
    for (const accion of accionesDe(texto)) {
      assert.ok(accionFijada(accion), `${f}: ${accion} sin SHA`);
    }
  });
}
