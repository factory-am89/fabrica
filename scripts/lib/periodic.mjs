// The startup step «periodico» (chunk 21 of plans/trabajar-solos.md): the local part of `audit` (no network) and the hygiene candidates,
// said only where they changed since the last time, plus what is owed: the readers that fire only by hand and have not run for more than
// MANUAL_STALE_DAYS, the GitHub part of `audit` (--data, --hitl) that never runs at startup, and the judge debt the last `audit --data` left.
// It never records a pass of `audit`: the days come from the passes somebody asked for with `npm run audit`, so they cannot reset by opening a session.
// Pablo authorised a step that runs by itself (decision A1 of the plan; standards/intervention.md says what runs alone asks him first).
// A part that fails is said (the step throws at the end with every failure) and does not stop the others.
// Everything it touches is injectable (the folder, the clock, the home, the measure), the defaults are the real ones.
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDICATORS, audit, humanLocal } from '../audit.mjs';
import { MS_DAY } from './audit-data.mjs';
import { DEBT_KIND, PASS_MODE, passesPath, readPasses } from './goals-debt.mjs';
import { judgeDatumPath, readJudgeDatum, readSnapshot, snapshotPath, writeSnapshot } from './periodic-state.mjs';

export const MANUAL_STALE_DAYS = 7;
export const STEP_NAME = 'periodico';
// The modes of `audit` that need a token and the network, so that never run at startup. A function, not a constant: this file is part of an
// import cycle (audit -> goals-debt -> triggers -> al-arrancar -> here) and PASS_MODE may not exist yet when it loads.
export const githubModes = () => [PASS_MODE.data, PASS_MODE.hitl];
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LINE = /^([^\s:][^:]*): (.*)$/;

// The text of the local audit -> { <indicator id>: <its first line> } (the indented lines are the detail of the one before).
export function indicatorLines(text) {
  const out = {};
  for (const l of text.split('\n')) {
    const m = LINE.exec(l);
    if (m !== null) out[m[1]] = m[2];
  }
  return out;
}

// [{ id, before, now }] of what differs between two sets of lines: a changed text, a new indicator (before null), one no longer measured (now null).
export function changesOf(before, now) {
  const ids = [...new Set([...Object.keys(before), ...Object.keys(now)])].sort();
  return ids.filter((id) => before[id] !== now[id]).map((id) => ({ id, before: before[id] ?? null, now: now[id] ?? null }));
}

const daysAgo = (now, t) => ((now - t) / MS_DAY).toFixed(1);

// The readers that fire only by hand (the manual-reader items of the debt), once each, whose last pass is older than MANUAL_STALE_DAYS or missing.
// [{ ref, mode, last }]; `last` is null when that mode never passed. Exactly MANUAL_STALE_DAYS is not yet stale.
export function staleManualReaders(items, passes, now) {
  const seen = new Set();
  const out = [];
  for (const it of items.filter((i) => i.kind === DEBT_KIND.manualReader)) {
    if (seen.has(it.ref)) continue;
    seen.add(it.ref);
    const last = passes[it.mode] ?? null;
    if (last === null || now - last > MANUAL_STALE_DAYS * MS_DAY) out.push({ ref: it.ref, mode: it.mode, last });
  }
  return out;
}

const when = (now, last) => (last === null ? 'ninguna pasada apuntada' : `última pasada hace ${daysAgo(now, last)} días`);

function judgeLines(datum, now) {
  if (datum === null) return [`periodico: deuda del juez: \`audit --${PASS_MODE.data}\` nunca dejó dato; no se sabe cuántos cambios del juez esperan pasada del corpus`];
  const { judge } = datum;
  const age = `dato de \`audit --${PASS_MODE.data}\` de hace ${daysAgo(now, Date.parse(datum.t))} días`;
  const passed = judge.lastPassedSha === null ? 'ninguna pasada buena del corpus' : `última pasada buena en ${judge.lastPassedSha}`;
  if (judge.count === 0) return [`periodico: deuda del juez: 0 cambios del juez sin pasada del corpus (${passed}; ${age})`];
  return [`periodico: deuda del juez: ${judge.count} cambios del juez sin pasada del corpus, el primero ${judge.firstAt} (${passed}; ${age}); la pasada la lanza Pablo`];
}

// What changed since the last run (said once, then kept for the next run).
function sayChanges(result, humano, file, now, escribir) {
  const lines = indicatorLines(humano(result));
  const before = readSnapshot(snapshotPath(file));
  escribir(`periodico: ${Object.keys(lines).length} indicadores locales medidos (sin red); higiene: ${result[INDICATORS.hygiene].total} candidatos`);
  const changes = before === null ? [] : changesOf(before.lines, lines);
  if (before === null) escribir('periodico: primera medida en este PC; no hay medida anterior con la que comparar');
  else if (changes.length === 0) escribir(`periodico: nada cambió desde la medida anterior (${before.t})`);
  for (const c of changes) escribir(`periodico: cambió ${c.id}: ${c.before ?? '(no existía)'} -> ${c.now ?? '(ya no se mide)'}`);
  writeSnapshot(snapshotPath(file), now, lines);
}

function sayStaleReaders(result, file, now, escribir) {
  for (const s of staleManualReaders(result[INDICATORS.goalsDebt].items, readPasses(file), now)) {
    escribir(s.last === null
      ? `periodico: lector manual «${s.ref}» nunca corrió (ninguna pasada ${s.mode} de audit apuntada)`
      : `periodico: lector manual «${s.ref}» lleva ${daysAgo(now, s.last)} días sin correr (más de ${MANUAL_STALE_DAYS}; pasada ${s.mode} de audit)`);
  }
}

// The step. `raiz`: the Fábrica folder; `reloj`: ms now; `casa`: the home function; `medir(raiz)`: the local audit result; `humano(result)`: its text.
export function pasoPeriodico({ raiz = ROOT, reloj = Date.now, casa = homedir, medir = (r) => audit(r), humano = (r) => humanLocal(r) } = {}) {
  return {
    nombre: STEP_NAME,
    ejecutar: (escribir) => {
      const now = reloj();
      const file = passesPath(casa);
      const fallos = [];
      const intentar = (parte, hacer) => {
        try { return hacer(); } catch (e) { fallos.push(`${parte}: ${e.message}`); return null; }
      };
      const result = intentar('medida local', () => medir(raiz));
      if (result !== null) {
        intentar('lo que cambió', () => sayChanges(result, humano, file, now, escribir));
        intentar('lectores manuales', () => sayStaleReaders(result, file, now, escribir));
      }
      intentar('deuda de GitHub', () => {
        const passes = readPasses(file);
        for (const mode of githubModes()) escribir(`periodico: deuda: \`audit --${mode}\` no corre al arrancar (pide token y red); ${when(now, passes[mode] ?? null)}`);
      });
      intentar('deuda del juez', () => judgeLines(readJudgeDatum(judgeDatumPath(file)), now).forEach((l) => escribir(l)));
      if (fallos.length > 0) throw new Error(fallos.join('; '));
    },
  };
}
