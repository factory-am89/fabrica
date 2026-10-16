// Los .ps1 se validan con el parser de Windows PowerShell 5.1 y lib-gh.ps1 se prueba contra
// un git de mentira (remoto local, config global en un fichero temporal). Solo en Windows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ruta = (r) => fileURLToPath(new URL(`../${r}`, import.meta.url));
const ps = (args) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', ...args], { encoding: 'utf8' });
const hayPs = process.platform === 'win32';

test('arranque.ps1, ruleset.ps1 y lib-gh.ps1 pasan el parser de PowerShell 5.1', { skip: !hayPs }, () => {
  for (const f of ['arranque', 'ruleset', 'lib-gh']) {
    const cmd = `$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${ruta(`apps/${f}.ps1`)}',[ref]$null,[ref]$e); if ($e.Count) { $e | ForEach-Object { $_.Message }; exit 1 }`;
    const r = ps(['-Command', cmd]);
    assert.equal(r.status, 0, `${f}.ps1: ${r.stdout}${r.stderr}`);
  }
});

test('lib-gh.ps1: login aislado del git y del llavero, permisos del token, comillas del helper y subida de main', { skip: !hayPs }, () => {
  const r = ps(['-ExecutionPolicy', 'Bypass', '-File', ruta('test/lib-gh.prueba.ps1'), '-Lib', ruta('apps/lib-gh.ps1')]);
  const lineas = r.stdout.split(/\r?\n/).filter((l) => /^(OK|FALLO):/.test(l));
  assert.ok(lineas.length >= 42, `salida inesperada: ${r.stdout}${r.stderr}`);
  assert.deepEqual(lineas.filter((l) => l.startsWith('FALLO')), []);
});

test('ruleset.ps1 sin -Repo o con un repo mal escrito para antes de tocar gh', { skip: !hayPs }, () => {
  const r = ps(['-ExecutionPolicy', 'Bypass', '-File', ruta('apps/ruleset.ps1')]);
  assert.notEqual(r.status, 0);
  assert.match(`${r.stdout}${r.stderr}`, /Repo/);
  const mal = ps(['-ExecutionPolicy', 'Bypass', '-File', ruta('apps/ruleset.ps1'), '-Repo', 'sinbarra']);
  assert.equal(mal.status, 1);
  assert.match(mal.stdout, /dueno\/nombre/);
});

// En PowerShell las funciones van antes que los ejecutables y no distinguen mayusculas: una funcion
// Gh con `& gh` dentro se llama a si misma sin fin. Los .ps1 de apps/ se cargan unos desde otros,
// asi que se mira el conjunto: ninguna funcion puede llamarse como un ejecutable que se llama con `&`
// (por eso se escribe `& gh.exe`).
test('apps/*.ps1: ninguna funcion tapa a un ejecutable que se llama con &', () => {
  const dir = ruta('apps');
  const funciones = [];
  const llamados = new Set();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ps1'))) {
    const t = readFileSync(`${dir}/${f}`, 'utf8');
    for (const m of t.matchAll(/^\s*function\s+([\w.-]+)/gim)) funciones.push({ f, nombre: m[1] });
    for (const m of t.matchAll(/&\s+(gh|op|git|node|claude)(?![\w.-])/gi)) llamados.add(m[1].toLowerCase());
  }
  const choques = funciones.filter((x) => llamados.has(x.nombre.toLowerCase()));
  assert.deepEqual(choques, [], 'funcion con el nombre de un ejecutable: llama al .exe (& gh.exe) o renombra la funcion');
});
