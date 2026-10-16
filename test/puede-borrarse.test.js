// La regla «¿se puede borrar esta carpeta?» vive en un solo sitio (scripts/lib/puede-borrarse.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fuente = (f) => readFileSync(new URL(`../scripts/${f}`, import.meta.url), 'utf8');

test('retirar y limpiar usan la misma regla y ninguno la repite', () => {
  for (const f of ['retirar.mjs', 'limpiar.mjs']) {
    const s = fuente(f);
    assert.match(s, /from '\.\/lib\/puede-borrarse\.mjs'/, `${f} importa la regla común`);
    assert.doesNotMatch(s, /status', '--porcelain'/, `${f} no repite la comprobación de cambios sin guardar`);
    assert.doesNotMatch(s, /spawnSync\('gh'/, `${f} no lanza gh a pelo`);
  }
});
