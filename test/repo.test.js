// El nombre del repo vive en scripts/lib/repo.mjs (principio 4: una idea, un sitio).
// Los .mjs lo importan; las copias que no pueden importarlo tienen que coincidir con él.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REPO } from '../scripts/lib/repo.mjs';

const leer = (r) => readFileSync(new URL(`../${r}`, import.meta.url), 'utf8');
// <dueño>/fabrica como nombre de repo (no rutas de Windows como C:\dev\fabrica ni fabrica-revisor).
const nombres = (src) => [...src.matchAll(/([A-Za-z0-9-]+)\/fabrica(?![\w-])/g)].map((m) => `${m[1]}/fabrica`);

test('repo: los .mjs importan scripts/lib/repo.mjs y no escriben el nombre a mano', () => {
  assert.match(REPO, /^[A-Za-z0-9-]+\/fabrica$/);
  for (const f of ['scripts/token.mjs', 'apps/convertir.mjs']) {
    const src = leer(f);
    assert.match(src, /from '(\.\.\/scripts|\.)\/lib\/repo\.mjs'/, `${f} debe importar REPO de scripts/lib/repo.mjs`);
    assert.deepEqual(nombres(src), [], `${f} escribe el nombre del repo a mano`);
  }
});

test('repo: cada copia que no puede importarlo coincide con scripts/lib/repo.mjs', () => {
  for (const f of ['apps/arranque.ps1', 'apps/ruleset.ps1', 'apps/crear-apps.html', 'PASOS-PABLO.md', '.github/workflows/revisor.yml']) {
    const encontrados = nombres(leer(f));
    assert.ok(encontrados.length > 0, `${f} ya no nombra el repo: quítalo de esta lista`);
    for (const n of encontrados) assert.equal(n, REPO, `${f} dice ${n} y la fuente dice ${REPO}`);
  }
});
