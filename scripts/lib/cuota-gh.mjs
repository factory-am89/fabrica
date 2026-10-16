// Ratchet for the GitHub quota (test/gh-quota.test.js). Finds, in the repo's code and in the skill/agent
// instructions, the two habits that spend the GraphQL quota without anyone counting (measured in MenuPlan on
// 2026-10-10 and 2026-10-14, not verified in this repo): a `--watch` on a gh command (a GraphQL query repeated for as long as it runs, per
// session) and `gh issue list` / `gh pr list` inside a loop (the cost is per requested item, every turn).
// It is a ratchet, not a proof: it reads text, so a list built far from its loop is not seen. Paths use `/`.
//
// What counts as an instruction (so that a text explaining why NOT to do it is not a false alarm):
//  - code files (.js .mjs .ps1 .sh .yml, hooks, package.json scripts): comments are stripped, strings are kept
//    (the command lives in a string). Nothing else is exempt.
//  - .md files under .claude/ and base/ (skills and agents): everything is scanned EXCEPT the sections named in
//    SECCIONES_EXPLICATIVAS. Those exist to tell what failed and why, so they may name the habit; the commands an
//    agent runs live in tables and code blocks of the other sections, which are scanned.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ficheros, quitarComentariosJs, quitarComentariosShell, textoDeScripts, tipoDe } from './puerta-op.mjs';

export const SECCIONES_EXPLICATIVAS = ['Lo que falló', 'La cuota de GitHub'];

// Files that spell the habits on purpose (fixtures of the test that guards them). Each needs a reason.
export const PROPIOS = {
  'test/gh-quota.test.js': 'fixtures of the ratchet: strings that use the habits on purpose',
};

const COMILLA = '([\'"`])';
// Text form: `gh ... --watch` and `gh ... issue|pr list` within one command (no pipe, `;` or `&` in between).
const WATCH_TEXTO = /\bgh\b[^\n|;&]*\s--watch\b/;
const LISTA_TEXTO = /\bgh\b[^\n|;&]*?\b(?:issue|pr)\s+list\b/;
// Array form, as in spawnSync('gh', ['pr', 'list']): looked for in the statement that starts at the 'gh' string.
const GH_ARRAY = new RegExp(`${COMILLA}gh(?:\\.exe)?\\1`, 'g');
const WATCH_ARRAY = new RegExp(`${COMILLA}--watch\\1`);
const LISTA_ARRAY = new RegExp(`${COMILLA}(?:issue|pr)\\1\\s*,\\s*${COMILLA}list\\2`);

// What opens a loop in the header before a `{` (JS / PowerShell).
const CABECERA_BUCLE_JS = /\b(?:for|while|do)\b|\.(?:forEach|map|flatMap|reduce|filter|some|every)\s*\(|\bsetInterval\b/;
const CABECERA_BUCLE_PS = /\b(?:foreach|for|while|do|until)\b|ForEach-Object|(?:^|\s)%\s*$/i;
// In shell, on the same line before the match: an inline loop (not closed by `done`), xargs, a piped while-read.
const LINEA_BUCLE_SH = /\b(?:for|while|until)\b[^\n]*\bdo\b|\bxargs\b|\bwhile\s+read\b/;

// Is the character at `indice` inside a loop body? Brace scan over the skeleton (code with comments and string
// contents blanked, same length). The statement text before `indice` counts too, for loops without braces:
// `items.map((x) => run('gh pr list'))`.
function enBucleLlaves(esqueleto, indice, cabeceraBucle) {
  const pila = [];
  let inicio = 0;
  let parentesis = 0;
  for (let i = 0; i < indice; i++) {
    const c = esqueleto[i];
    if (c === '(') parentesis++;
    else if (c === ')') parentesis = Math.max(0, parentesis - 1);
    else if (c === ';' && parentesis === 0) inicio = i + 1;
    else if (c === '{') { pila.push(cabeceraBucle.test(esqueleto.slice(inicio, i))); inicio = i + 1; parentesis = 0; }
    else if (c === '}') { pila.pop(); inicio = i + 1; parentesis = 0; }
  }
  return pila.includes(true) || cabeceraBucle.test(esqueleto.slice(inicio, indice));
}

// Shell: depth of `for/while/until ... done` blocks at the match line, plus an inline loop before the match.
function enBucleSh(codigo, indice) {
  const antes = codigo.slice(0, indice);
  const lineas = antes.split('\n');
  const actual = lineas.pop();
  let profundidad = 0;
  for (const l of lineas) {
    if (/^\s*(?:for|while|until)\b/.test(l)) profundidad++;
    if (/\bdone\b/.test(l)) profundidad = Math.max(0, profundidad - 1);
  }
  const k = actual.lastIndexOf('done');
  const trasDone = k === -1 ? actual : actual.slice(k + 4);
  return profundidad > 0 || LINEA_BUCLE_SH.test(trasDone);
}

const enBucle = (tipo, codigo, esqueleto, indice) => (tipo === 'sh' ? enBucleSh(codigo, indice) : enBucleLlaves(esqueleto, indice, tipo === 'ps' ? CABECERA_BUCLE_PS : CABECERA_BUCLE_JS));

const lineaDe = (codigo, indice) => codigo.slice(0, indice).split('\n').length;

// Findings in comment-free code of a type ('js' | 'ps' | 'sh'): [{ regla, linea }].
function reglas(codigo, tipo, esqueleto = codigo) {
  const salida = [];
  const anota = (regla, indice) => salida.push({ regla, linea: lineaDe(codigo, indice) });
  for (const m of codigo.matchAll(new RegExp(WATCH_TEXTO, 'g'))) anota('gh-watch', m.index);
  for (const m of codigo.matchAll(new RegExp(LISTA_TEXTO, 'g'))) if (enBucle(tipo, codigo, esqueleto, m.index)) anota('gh-list-in-loop', m.index);
  if (tipo === 'js') {
    for (const m of codigo.matchAll(GH_ARRAY)) {
      const resto = codigo.slice(m.index, m.index + 400);
      const ventana = resto.slice(0, resto.includes(';') ? resto.indexOf(';') : resto.length);
      const w = WATCH_ARRAY.exec(ventana);
      if (w) anota('gh-watch', m.index + w.index);
      const l = LISTA_ARRAY.exec(ventana);
      if (l && enBucle(tipo, codigo, esqueleto, m.index)) anota('gh-list-in-loop', m.index + l.index);
    }
  }
  const vistos = new Set();
  return salida.filter((h) => !vistos.has(`${h.regla}:${h.linea}`) && vistos.add(`${h.regla}:${h.linea}`));
}

// PowerShell strings are blanked per line (same length) so that braces inside them do not count.
const blanquearCadenasPs = (texto) => texto.split('\n').map((l) => l.replace(/'[^']*'|"(?:[^"`]|`.)*"/g, (m) => m[0] + ' '.repeat(m.length - 2) + m[0])).join('\n');

// The code to match (comments stripped, strings kept) and its skeleton (strings blanked) for the loop scan.
function codigoDe(tipo, texto) {
  if (tipo === 'js') return { codigo: quitarComentariosJs(texto), esqueleto: quitarComentariosJs(texto, { blanquearCadenas: true }) };
  const codigo = quitarComentariosShell(texto, { bloques: tipo === 'ps' });
  return { codigo, esqueleto: tipo === 'ps' ? blanquearCadenasPs(codigo) : codigo };
}

// Markdown: fenced blocks are shell code; the rest is prose where only `--watch` can be told. Explanatory sections are skipped.
function escanearMarkdown(texto) {
  const lineas = texto.split('\n');
  const salida = [];
  let exenta = false;
  let bloque = null; // { desde, lineas }
  lineas.forEach((l, i) => {
    if (/^\s*```/.test(l)) {
      if (bloque) {
        if (!exenta) {
          const codigo = quitarComentariosShell(bloque.lineas.join('\n'));
          for (const h of reglas(codigo, 'sh')) salida.push({ regla: h.regla, linea: bloque.desde + h.linea });
        }
        bloque = null;
      } else bloque = { desde: i + 1, lineas: [] };
      return;
    }
    if (bloque) { bloque.lineas.push(l); return; }
    const titulo = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(l);
    if (titulo) { exenta = SECCIONES_EXPLICATIVAS.includes(titulo[1]); return; }
    if (!exenta && WATCH_TEXTO.test(l)) salida.push({ regla: 'gh-watch', linea: i + 1 });
  });
  if (bloque) throw new Error('unterminated code fence');
  return salida;
}

// Findings in one file's text: [{ regla, linea, texto }]. Throws if the file cannot be read as code.
export function escanearTexto(ruta, texto) {
  const originales = texto.split('\n');
  let hallazgos;
  if (ruta.endsWith('.md')) hallazgos = escanearMarkdown(texto);
  else {
    const tipo = tipoDe(ruta);
    if (!tipo) return [];
    const { codigo, esqueleto } = codigoDe(tipo, texto);
    hallazgos = reglas(codigo, tipo, esqueleto);
  }
  return hallazgos.map((h) => ({ ...h, texto: (originales[h.linea - 1] ?? '').trim().slice(0, 120) }));
}

const esInstruccionMd = (ruta) => ruta.endsWith('.md') && (ruta.startsWith('.claude/') || ruta.startsWith('base/'));

// Every finding in the repo at `raiz`: [{ fichero, regla, linea, texto }]. A file that is code (or an instruction)
// but cannot be read is a finding too (rule `unreadable`): a scanner that skips it would be a false guard.
export function escanear(raiz, propios = PROPIOS) {
  const salida = [];
  for (const fichero of ficheros(raiz)) {
    if (Object.hasOwn(propios, fichero)) continue;
    const esPaquete = fichero === 'package.json';
    if (!esPaquete && !tipoDe(fichero) && !esInstruccionMd(fichero)) continue;
    try {
      const crudo = readFileSync(join(raiz, fichero), 'utf8');
      const hallazgos = esPaquete ? escanearTexto('package.sh', textoDeScripts(crudo)) : escanearTexto(fichero, crudo);
      for (const h of hallazgos) salida.push({ fichero, ...h });
    } catch (e) {
      salida.push({ fichero, regla: 'unreadable', linea: 0, texto: e.message });
    }
  }
  return salida;
}
