// The local sources of scripts/audit.mjs that need nothing but files: reading and listing them, and the figures about the questions, the
// lessons, the budget of the ratchet and the interventions. Moved out of scripts/audit.mjs, which was at the 200-line limit.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { contarIntervenciones, ORIGEN_AGENTE } from './intervention-log.mjs';
import { DATED_ROW, INTERVENCIONES_FILE, readLessons } from './lessons.mjs';
import { NoQuestionsError, readQuestions } from './questions.mjs';
import { RULES_BUDGET_FILE } from './skills.mjs';

export const readText = (root, rel) => readFileSync(path.join(root, rel), 'utf8');
export const listFiles = (root, dir, filter = () => true) => {
  const abs = path.join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .filter(filter)
    .sort();
};
export const tally = (values) => {
  const out = {};
  for (const v of values) out[v] = Object.hasOwn(out, v) ? out[v] + 1 : 1;
  return out;
};
export const lineCount = (text) => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);

export function questionsOf(root) {
  const files = listFiles(root, 'standards', (f) => f.endsWith('.md'));
  const all = [];
  for (const f of files) {
    try { all.push(...readQuestions(readText(root, f))); } catch (e) { if (!(e instanceof NoQuestionsError)) throw e; }
  }
  return { total: all.length, byCheckedBy: tally(all.map((q) => q.checkedBy)) };
}

export function lessonsOf(root) {
  const lessons = readLessons(root).map((l) => JSON.parse(l.text));
  return {
    signal: { total: lessons.length, bySignal: tally(lessons.map((d) => d.signal)) },
    reason: tally(lessons.flatMap((d) => d.reason ?? [])),
    escaped: lessons.filter((d) => d.escaped === true).length,
  };
}

// Reads the budget of chunk 6 (rules-without-reader.json), never recomputes the bullets without lesson.
export function rulesWithoutReader(root) {
  const budget = JSON.parse(readText(root, RULES_BUDGET_FILE)).budget;
  return { total: Object.values(budget).reduce((a, n) => a + n, 0), bySkill: budget };
}

export function hitlOf(root, logPath) {
  const c = contarIntervenciones(logPath === undefined ? undefined : { ruta: logPath });
  const rows = readText(root, INTERVENCIONES_FILE).split('\n').filter((l) => DATED_ROW.test(l)).length;
  return { selfDeclared: c.porOrigen[ORIGEN_AGENTE], total: c.total, corrupt: c.corruptas, tableRows: rows };
}
