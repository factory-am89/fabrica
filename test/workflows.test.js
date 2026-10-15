// Un workflow que no es YAML válido lo rechaza GitHub al lanzarlo y el check ni arranca:
// cada fichero de .github/workflows/ tiene que parsear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const DIR = path.resolve(import.meta.dirname, '..', '.github', 'workflows');
const ficheros = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));

test('hay workflows que vigilar', () => assert.ok(ficheros.length > 0));

for (const f of ficheros) {
  test(`workflow ${f}: es YAML válido con jobs`, () => {
    const doc = yaml.load(readFileSync(path.join(DIR, f), 'utf8'));
    assert.equal(typeof doc, 'object');
    assert.ok(doc.jobs && Object.keys(doc.jobs).length > 0, 'sin jobs');
  });
}
