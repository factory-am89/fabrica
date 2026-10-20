// What test/periodic.test.js and test/periodic-state.test.js share: a fake local audit, the step wired to a throwaway home, and a judge debt.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pasoPeriodico } from '../../scripts/lib/periodic.mjs';
import { DEBT_KIND, PASS_MODE } from '../../scripts/lib/goals-debt.mjs';

export const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const NOW = Date.parse('2026-10-20T10:00:00Z');
export const manual = (ref, mode = PASS_MODE.local) => ({ kind: DEBT_KIND.manualReader, ref, goals: ['O1'], mode, detail: null });

// A fake local audit as measureLocal returns it: the text of the audit, the static debt and the number of hygiene candidates.
export const medida = (text, items = [], hygiene = 3) => ({ text, hygiene, items });
export const paso = (casa, result, extra = {}) => pasoPeriodico({ raiz: RAIZ, reloj: () => NOW, casa: () => casa.casa, medir: () => result, ...extra });

// { lineas, error }: what the step said and the message it threw (null when it did not).
export const fallo = (p) => {
  const lineas = [];
  let error = null;
  try { p.ejecutar((l) => lineas.push(l)); } catch (e) { error = e.message; }
  return { lineas, error };
};
export const correr = (p) => {
  const r = fallo(p);
  assert.equal(r.error, null);
  return r.lineas;
};

export const judge = (extra = {}) => ({ computed: true, lastPassedSha: 'abc123', count: 2, shas: ['s1', 's2'], firstAt: '2026-10-01T00:00:00.000Z', ...extra });
export const JUEZ = 'periodico: deuda del juez';
export const juez = (lineas) => lineas.filter((l) => l.startsWith(JUEZ));
