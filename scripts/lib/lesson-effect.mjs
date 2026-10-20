// Three indicators of `audit --data` (chunk 17 of plans/trabajar-solos.md), from the PRs and `revisor` records plus the Fábrica's own
// lessons and triaged «no»: the effect of each lesson on the «no» of its question, the «no» nobody triaged, and the false-«no» rate of each question.
// Signals, not gates: no threshold here fails anything. Pure functions except the two readers (lessons, golden outputs).
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { CORPUS, MIN_CASES_PER_CELL, STANDARD, answersOf, loadCorpus, loadOutputs } from '../golden.mjs';
import { variance } from '../golden-run.mjs';
import { cargarPreguntas } from '../veredicto.mjs';
import { NO_LESSON_KEYS, NO_QUESTION, REASON_NOISE, readLessons, readNoLesson, sourceNumber } from './lessons.mjs';
import { ANSWER, OVERRIDE_TITLE, aggregate, readCheckRuns } from './record.mjs';

// Why a lesson has no conclusive effect (a list: it can be several).
export const WHY = Object.freeze({ noQuestion: 'lesson-without-question', noDate: 'no-merged-source-pr', sourceNotInData: 'source-pr-not-in-data', fewCases: 'few-cases-on-a-side' });
export const CAVEAT = Object.freeze({
  overridesPerRound: 'an-override-counts-once-per-no-question-of-the-round-it-overrides',
  caseIsAnswered: 'cases-are-rounds-that-answered-si-or-no',
});
export const MIN_TRIALS = 2;
const TRIAL_FILE = /^\d+\.json$/;

const rate = (n, d) => (d === 0 ? null : n / d);

// The ONE place that reads the triaged «no» (no-lesson.json today). Returns [{source: PR number, question, noise: boolean}].
// plans/registro-de-no.md moves this reading to reviewer-no.json: only this function changes.
export function readTriagedNo(root) {
  const d = JSON.parse(readNoLesson(root));
  if (!Array.isArray(d.entries)) throw new Error('triaged «no»: entries must be a list');
  return d.entries.map((e) => ({ source: sourceNumber(e[NO_LESSON_KEYS.source]), question: e[NO_LESSON_KEYS.question], noise: e[NO_LESSON_KEYS.reason] === REASON_NOISE }));
}

// [{id, question, sources: [PR number]}] from lessons/; a lesson without a list of sources stops the figure.
export function readLessonSources(root) {
  return readLessons(root).map((l) => {
    const d = JSON.parse(l.text);
    if (!Array.isArray(d.sources)) throw new Error(`lesson ${l.id}: no list of sources`);
    return { id: l.id, question: d.question, sources: d.sources.map(sourceNumber) };
  });
}

// The questions the judge answers differently between trials of the golden pass in `dir` (outputs of scripts/golden-run.mjs), sorted.
export function unstableQuestions(dir, root, corpus = CORPUS) {
  const preguntas = cargarPreguntas(STANDARD, root);
  const cases = loadCorpus(corpus, preguntas);
  const trials = readdirSync(path.join(dir, cases[0].id)).filter((f) => TRIAL_FILE.test(f)).length;
  if (trials < MIN_TRIALS) throw new Error(`golden outputs: ${trials} trial(s) per case; at least ${MIN_TRIALS} are needed to see instability`);
  const texts = loadOutputs(dir, cases, trials);
  const answers = Object.fromEntries(cases.map((c) => [c.id, texts[c.id].map((x, i) => answersOf(x, preguntas, `${c.id}/${i + 1}.json`))]));
  return Object.keys(variance(cases, answers).preguntas).sort();
}

// What the three indicators read from the Fábrica's own files; golden = the outputs folder of a golden-run pass, or null.
export const localInputs = (root, golden) => ({ lessons: readLessonSources(root), triaged: readTriagedNo(root), unstable: golden === null ? null : unstableQuestions(golden, root) });

// check-runs -> { rounds: [{pr, sha, ok, answers}] of the records without error, overrideShas: [sha] }. An unreadable one stops the figure.
function readRounds(checkRuns) {
  const { records, unreadable } = readCheckRuns(checkRuns);
  if (unreadable.length > 0) throw new Error(`check-runs without a readable record (index: ${unreadable.map((u) => u.index).join(', ')})`);
  const overrideShas = checkRuns.filter((c) => c.output?.title === OVERRIDE_TITLE).map((c) => c.head_sha);
  if (overrideShas.some((s) => typeof s !== 'string')) throw new Error('an override check-run has no head_sha: it cannot be placed in a round');
  return { records, overrideShas };
}

const side = (rounds, question) => {
  const answered = rounds.filter((r) => r.answers[question] === ANSWER.yes || r.answers[question] === ANSWER.no);
  const no = answered.filter((r) => r.answers[question] === ANSWER.no).length;
  return { cases: answered.length, no, rate: rate(no, answered.length) };
};

// Per lesson: the «no» rate of its question in the rounds of PRs created before / from the lesson's date (the merge of its latest merged
// source PR: a lesson has no date of its own). A side with fewer than MIN_CASES_PER_CELL cases makes it «no concluyente».
function lessonEffect(lessons, prs, records) {
  const byNumber = new Map(prs.map((p) => [p.number, p]));
  const rounds = records.filter((r) => r.error === null).map((r) => {
    const pr = byNumber.get(r.pr);
    if (pr === undefined) throw new Error(`a record of PR #${r.pr} has no PR in the data`);
    return { created: pr.created, answers: r.answers };
  });
  const out = lessons.map((l) => {
    // A source PR missing from the data (outside --since, say) hides what the latest merge was: the date is unknown, said apart from «not merged».
    const found = l.sources.map((n) => byNumber.get(n));
    const missing = found.includes(undefined);
    const merged = found.filter((p) => p !== undefined && p.merged !== null).map((p) => p.merged);
    const date = missing || merged.length === 0 ? null : Math.max(...merged);
    const why = [];
    if (l.question === NO_QUESTION) why.push(WHY.noQuestion);
    if (missing) why.push(WHY.sourceNotInData);
    else if (date === null) why.push(WHY.noDate);
    if (why.length > 0) return { id: l.id, question: l.question, date: date === null ? null : new Date(date).toISOString(), before: null, after: null, change: null, conclusive: false, why };
    const before = side(rounds.filter((r) => r.created < date), l.question);
    const after = side(rounds.filter((r) => r.created >= date), l.question);
    if (before.cases < MIN_CASES_PER_CELL || after.cases < MIN_CASES_PER_CELL) why.push(WHY.fewCases);
    const conclusive = why.length === 0;
    return { id: l.id, question: l.question, date: new Date(date).toISOString(), before, after, change: conclusive ? after.rate - before.rate : null, conclusive, why };
  });
  return { minCases: MIN_CASES_PER_CELL, count: out.length, conclusive: out.filter((l) => l.conclusive).length, caveat: CAVEAT.caseIsAnswered, lessons: out };
}

// The (PR, question) pairs with a «no» in some round, and which of them no lesson (with that PR as source and that question) nor triaged entry covers.
function unsortedNo(lessons, triaged, records) {
  const found = new Map();
  for (const r of records.filter((x) => x.error === null)) {
    for (const [question, a] of Object.entries(r.answers)) {
      if (a !== ANSWER.no) continue;
      const key = JSON.stringify([r.pr, question]);
      found.set(key, { pr: r.pr, question, rounds: (found.get(key)?.rounds ?? 0) + 1 });
    }
  }
  const covered = (x) => lessons.some((l) => l.question === x.question && l.sources.includes(x.pr)) || triaged.some((t) => t.question === x.question && t.source === x.pr);
  const items = [...found.values()].filter((x) => !covered(x)).sort((a, b) => a.pr - b.pr || a.question.localeCompare(b.question));
  return { total: found.size, count: items.length, items };
}

// Per question: «no» (rounds), false «no» = triaged as judge noise + Pablo's overrides, and their rate; each override is placed in the round of its commit.
function falseNo(triaged, records, overrideShas, unstable) {
  const { porPregunta } = aggregate(records);
  const questions = [...new Set([...Object.keys(porPregunta), ...triaged.map((t) => t.question)])].sort();
  const overridden = new Map();
  let unattributed = 0;
  for (const sha of overrideShas) {
    const noOf = records.filter((r) => r.sha === sha && r.error === null).flatMap((r) => Object.entries(r.answers).filter(([, a]) => a === ANSWER.no).map(([q]) => q));
    if (noOf.length === 0) unattributed += 1;
    for (const q of new Set(noOf)) overridden.set(q, (overridden.get(q) ?? 0) + 1);
  }
  const byQuestion = Object.fromEntries(questions.map((q) => {
    const no = porPregunta[q]?.[ANSWER.no] ?? 0;
    const noise = triaged.filter((t) => t.noise && t.question === q).length;
    const overrides = overridden.get(q) ?? 0;
    return [q, { no, noise, overrides, falseNo: noise + overrides, rate: rate(noise + overrides, no), unstable: unstable === null ? null : unstable.includes(q) }];
  }));
  return { byQuestion, overridesUnattributed: unattributed, unstableQuestions: unstable, caveat: CAVEAT.overridesPerRound };
}

// prs: readPulls() of the data; local: localInputs() or null (a --repo run: not applicable).
export function lessonIndicators(prs, checkRuns, local) {
  if (local === null) return { lessonEffect: null, unsortedNo: null, falseNo: null };
  const { records, overrideShas } = readRounds(checkRuns);
  return {
    lessonEffect: lessonEffect(local.lessons, prs, records),
    unsortedNo: unsortedNo(local.lessons, local.triaged, records),
    falseNo: falseNo(local.triaged, records, overrideShas, local.unstable),
  };
}
