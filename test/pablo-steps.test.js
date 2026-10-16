// PASOS-PABLO.md and the admin scripts in apps/*.ps1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { leer } from './apoyo/fabrica.mjs';

test('PASOS-PABLO manda al script real; arranque ejecuta environment, apps, subida y ruleset en ese orden', () => {
  const pasos = leer('PASOS-PABLO.md');
  // La ruta exacta que se pega en PowerShell, y que el fichero existe en el repo.
  const orden1 = 'powershell -ExecutionPolicy Bypass -File C:\\dev\\fabrica-v0-revisor\\apps\\arranque.ps1';
  assert.ok(pasos.includes(orden1), 'PASOS-PABLO no trae la orden exacta del paso 1');
  assert.ok(existsSync(new URL('../apps/arranque.ps1', import.meta.url)));
  assert.match(pasos, /Ningún constructor trabaja antes de que exista el ruleset/);
  assert.ok(pasos.includes('C:\\dev\\fabrica\\apps\\'), 'falta dónde vive el script tras fusionar');
  const arranque = leer('apps/arranque.ps1');
  // Orden de EJECUCIÓN: las llamadas `Paso '…'` del cuerpo, no la tabla de estado de arriba.
  const ejecutados = [...arranque.matchAll(/^\s*Paso '([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual(ejecutados, [
    '1 Sesion de gh',
    '2 Environment revisor (main)',
    '3 Cuenta de servicio (llavero)',
    '3 App fabrica-constructor',
    '3 App fabrica-revisor',
    '4 Apps instaladas en el repo',
    '5 Token de Claude',
    '6 Allow auto-merge',
    '7 Subir main (v0)',
    '8 Ruleset de main',
  ]);
  assert.ok(arranque.indexOf('environments/revisor') < arranque.indexOf("Paso '3 App fabrica-revisor'"));
  assert.match(arranque, /ruleset\.ps1'\) -Repo .* -SesionAbierta/);
  assert.doesNotMatch(arranque, /node\s+'scripts/, 'el script de admin no saca la clave de 1Password');
  assert.doesNotMatch(arranque, /&\s*gh auth login/, 'el login va por Gh-Login, que no deja helper en git');
  assert.match(leer('apps/lib-gh.ps1'), /auth login/);
  const ruleset = leer('apps/ruleset.ps1');
  assert.doesNotMatch(ruleset, /check-runs/, 'el check revisor no debe haber corrido antes: solo corre en PR');
  // El cuerpo del ruleset vive en Cuerpo-Ruleset (apps/lib-gh.ps1). Su comportamiento lo prueba
  // test/lib-gh.prueba.ps1 (solo Windows); estas aserciones sobre el texto corren tambien en el CI de Linux.
  assert.match(ruleset, /Cuerpo-Ruleset \$NombreRuleset \$ContextoTests \$IdGitHubActions \$idRevisor/);
  assert.doesNotMatch(ruleset, /type = '/, 'el cuerpo del ruleset no se repite en ruleset.ps1');
  const lib = leer('apps/lib-gh.ps1');
  assert.match(lib, /context = 'revisor'; integration_id = \$IdRevisor/);
  assert.match(lib, /context = \$ContextoTests; integration_id = \$IdActions/);
  assert.match(lib, /type = 'non_fast_forward'/);
  assert.match(lib, /type = 'deletion'/);
  assert.doesNotMatch(lib, /type = 'update'/);
  assert.match(lib, /bypass_actors = @\(\)/);
});

test('ruleset.ps1 sirve a repos de organizacion: -Repo obligatorio, sin repo ni usuario escritos, sesion admin', () => {
  const ruleset = leer('apps/ruleset.ps1');
  assert.match(ruleset, /\[Parameter\(Mandatory = \$true\)\]\[string\]\$Repo,/);
  assert.match(ruleset, /\[string\]\$ContextoTests = 'tests'/);
  assert.doesNotMatch(ruleset, /pabloam89\/fabrica/, 'repo obsoleto');
  assert.doesNotMatch(ruleset, /\$Repo = '/, '-Repo no tiene valor por defecto');
  assert.doesNotMatch(ruleset, /-ne \$Dueno|-ne '\$Dueno'/, 'la sesion no tiene que ser del dueno del repo');
  assert.match(ruleset, /permissions\.admin/, 'la sesion debe ser admin del repo');
  assert.match(ruleset, /elseif \(-not \$AbriSesion\)/, 'una sesion de gh que ya existia no se cierra al acabar');
  assert.match(ruleset, /Buscar-App-Instalada \$AppRevisor \$Dueno/, 'la App debe estar instalada en la cuenta duena');
});

test('CLAUDE.md, PASOS-PABLO.md y apps/*.ps1 no llevan caracteres de control', () => {
  const ps1 = readdirSync(new URL('../apps/', import.meta.url)).filter((f) => f.endsWith('.ps1')).map((f) => `apps/${f}`);
  assert.ok(ps1.length >= 3, 'no encuentro los .ps1 de apps/');
  for (const f of ['CLAUDE.md', 'PASOS-PABLO.md', ...ps1]) assert.doesNotMatch(leer(f), /[\x00-\x08\x0b\x0c\x0e-\x1f]/, f); // eslint-disable-line no-control-regex
});
