// Form check for architect plans: pure functions, no disk, no network, no git.
// PLAN_FIELDS and PLAN_FAULTS are the single definition of the plan shape; a future standards/plan.md cites them.
import { COMPARE_LIMIT } from './pr-body.mjs';
import { touchesClosedList } from './intervention.mjs';
import { decisionFaults } from './decision.mjs';

export const PLAN_FIELDS = Object.freeze({
  files: 'Files',
  dependsOn: 'Depends on',
  blockedBy: 'Blocked by',
  existing: 'Existing',
  notDone: 'Not done',
  done: 'Done',
});

export const PLAN_FAULTS = Object.freeze(
  Object.fromEntries([
    'EMPTY_PLAN',
    'MISSING_TITLE',
    'MISSING_VERDICT',
    'MISSING_CHUNKS_SECTION',
    'MISSING_NOT_VERIFIED',
    'MISSING_DECISIONS_TAKEN',
    'BAD_DECISION_LINE',
    'NO_CHUNKS',
    'BAD_CHUNK_HEADER',
    'NUMBERING',
    'MISSING_FIELD',
    'EMPTY_NOT_DONE',
    'DONE_NOT_BLOCK',
    'DONE_PLACEHOLDER',
    'UNKNOWN_DEPENDENCY',
    'DEPENDENCY_CYCLE',
    'UNKNOWN_DECISION',
    'BAD_DECISION_HEADER',
    'DECISION_OPTIONS',
    'DECISION_NO_RECOMMENDED',
    'TOO_MANY_DECISIONS',
    'SHARED_FILE',
    'CLOSED_WITHOUT_DECISION',
  ].map((c) => [c, c])),
);

// The section whose lines decision.mjs reads (the only reader of a decision line); None is valid there.
export const DECISIONS_TAKEN_SECTION = 'Decisions taken';

export const MAX_DECISIONS = 3;
export const OPTIONS_PER_DECISION = 3;

const FIELD_LINE = new RegExp(`^(${Object.values(PLAN_FIELDS).join('|')}):[ \\t]*(.*)$`);
const FIELD_KEY_BY_LABEL = Object.fromEntries(Object.entries(PLAN_FIELDS).map(([k, v]) => [v, k]));

// Split lines at headings matching `re`, ignoring lines inside fenced code blocks.
function splitAt(lines, re) {
  const head = [];
  const parts = [];
  let fence = false;
  for (const line of lines) {
    if (/^\x60{3}/.test(line)) fence = !fence;
    const m = fence ? null : re.exec(line);
    if (m) parts.push({ match: m, lines: [] });
    else (parts.length ? parts[parts.length - 1].lines : head).push(line);
  }
  return { head, parts };
}

function fieldsOf(lines) {
  const fields = {};
  let current = null;
  let fence = false;
  for (const line of lines) {
    const m = fence ? null : FIELD_LINE.exec(line);
    if (m) {
      const key = FIELD_KEY_BY_LABEL[m[1]];
      if (key in fields) current = null;
      else {
        current = key;
        fields[key] = [m[2]];
      }
    } else if (current) {
      fields[current].push(line);
    }
    if (/^\x60{3}/.test(line)) fence = !fence;
  }
  return fields;
}

function parseDone(lines) {
  const open = lines.findIndex((l, i) => i > 0 && /^\x60{3}/.test(l));
  if (open < 0) return { closed: false, code: null };
  const close = lines.findIndex((l, i) => i > open && /^\x60{3}\s*$/.test(l));
  if (close < 0) return { closed: false, code: lines.slice(open + 1).join('\n') };
  return { closed: true, code: lines.slice(open + 1, close).join('\n') };
}

// The plan's own word for an empty list in «Depends on» and «Blocked by».
export const NONE_WORD = 'none';
const listOf = (s) => s.split(',').map((t) => t.trim()).filter(Boolean);

function parseDeps(value) {
  const tokens = listOf(value);
  if (tokens.length === 1 && tokens[0].toLowerCase() === NONE_WORD) return [];
  return tokens.map((t) => (/^\d+$/.test(t) ? Number(t) : t));
}

function parseBlocked(value) {
  const tokens = listOf(value);
  if (tokens.length === 1 && tokens[0].toLowerCase() === NONE_WORD) return [];
  return tokens;
}

export function parsePlan(text) {
  if (typeof text !== 'string') throw new TypeError('parsePlan: text must be a string');
  const top = splitAt(text.split(/\r?\n/), /^## (.*?)\s*$/);
  const title = top.head.map((l) => /^# Plan:[ \t]*(\S.*?)\s*$/.exec(l)).find(Boolean)?.[1] ?? null;
  const verdict = top.head.map((l) => /^Verdict:[ \t]*(\S.*?)\s*$/.exec(l)).find(Boolean)?.[1] ?? null;
  const section = (name) => top.parts.find((p) => p.match[1] === name) ?? null;

  const chunksSection = section('Chunks');
  const chunks = [];
  const badChunkHeaders = [];
  if (chunksSection) {
    for (const part of splitAt(chunksSection.lines, /^### (.*?)\s*$/).parts) {
      const h = /^(\d+)\. (\S.*)$/.exec(part.match[1]);
      if (!h) {
        badChunkHeaders.push(part.match[1]);
        continue;
      }
      const f = fieldsOf(part.lines);
      const has = (k) => k in f;
      const first = (k) => f[k][0].trim();
      const whole = (k) => (has(k) ? f[k].join('\n').trim() : null);
      chunks.push({
        n: Number(h[1]),
        title: h[2],
        files: has('files') ? [...first('files').matchAll(/\x60([^\x60]+)\x60/g)].map((m) => m[1]) : null,
        dependsOn: has('dependsOn') ? parseDeps(first('dependsOn')) : null,
        blockedBy: has('blockedBy') ? parseBlocked(first('blockedBy')) : null,
        existing: whole('existing'),
        notDone: whole('notDone'),
        done: has('done') ? parseDone(f.done) : null,
      });
    }
  }

  const decisionsSection = section('Decisions for Pablo');
  const decisions = [];
  const badDecisionHeaders = [];
  if (decisionsSection) {
    for (const part of splitAt(decisionsSection.lines, /^### (.*?)\s*$/).parts) {
      const h = /^([A-Z])\. (\S.*)$/.exec(part.match[1]);
      if (!h) {
        badDecisionHeaders.push(part.match[1]);
        continue;
      }
      const options = part.lines.map((l) => /^\d+\. (\S.*?)\s*$/.exec(l)).filter(Boolean).map((m) => m[1]);
      decisions.push({ id: h[1], question: h[2], options });
    }
  }

  const dt = section(DECISIONS_TAKEN_SECTION);
  const nv = section('Not verified');
  return {
    title,
    verdict,
    hasChunksSection: chunksSection !== null,
    chunks,
    badChunkHeaders,
    decisions,
    badDecisionHeaders,
    decisionsTaken: dt ? dt.lines.join('\n').trim() : null,
    notVerified: nv ? nv.lines.join('\n').trim() : null,
  };
}

function matchesAny(file, entries) {
  return entries.some((e) => (e.endsWith('/') ? file.startsWith(e) : file === e));
}

function requireList(name, value) {
  if (!Array.isArray(value)) throw new TypeError(`planFaults: ${name} must be an array`);
}

// Returns {faults, chunks}; chunks carry the derived data gate (Files meet gateFiles) and
// needsPablo (the Files that meet closedPaths). The plan never writes these by hand.
export function checkPlan(text, { gateFiles = [], closedPaths = [], rules } = {}) {
  requireList('gateFiles', gateFiles);
  requireList('closedPaths', closedPaths);
  const faults = [];
  const add = (code, where, message) => faults.push({ code, where, message });

  if (text === null || text === undefined || (typeof text === 'string' && text.trim() === '')) {
    add(PLAN_FAULTS.EMPTY_PLAN, 'plan', 'the plan text is empty');
    return { faults, chunks: [] };
  }
  const plan = parsePlan(text);
  if (plan.title === null) add(PLAN_FAULTS.MISSING_TITLE, 'plan', 'missing "# Plan: <title>" line');
  if (plan.verdict === null) add(PLAN_FAULTS.MISSING_VERDICT, 'plan', 'missing "Verdict: <one line>" line');
  if (!plan.hasChunksSection) add(PLAN_FAULTS.MISSING_CHUNKS_SECTION, 'plan', 'missing "## Chunks" section');
  else if (plan.chunks.length === 0 && plan.badChunkHeaders.length === 0) add(PLAN_FAULTS.NO_CHUNKS, 'plan', 'the plan has zero chunks');
  if (plan.notVerified === null) add(PLAN_FAULTS.MISSING_NOT_VERIFIED, 'plan', 'missing "## Not verified" section');
  if (plan.decisionsTaken === null || plan.decisionsTaken === '') {
    add(PLAN_FAULTS.MISSING_DECISIONS_TAKEN, 'plan', `missing or empty "## ${DECISIONS_TAKEN_SECTION}" section (write None when there is nothing to record)`);
  } else {
    for (const f of decisionFaults(plan.decisionsTaken, rules)) add(PLAN_FAULTS.BAD_DECISION_LINE, `${DECISIONS_TAKEN_SECTION} line ${f.line}`, `${f.code}: ${f.message}`);
  }
  for (const h of plan.badChunkHeaders) add(PLAN_FAULTS.BAD_CHUNK_HEADER, `chunk header "${h}"`, 'expected "### <n>. <title>"');

  plan.chunks.forEach((c, i) => {
    if (c.n !== i + 1) add(PLAN_FAULTS.NUMBERING, `chunk ${c.n}`, `chunk at position ${i + 1} is numbered ${c.n}; numbering must run 1, 2, 3...`);
  });

  const byN = new Map(plan.chunks.map((c) => [c.n, c]));
  const decisionIds = new Set(plan.decisions.map((d) => d.id));

  for (const c of plan.chunks) {
    const where = `chunk ${c.n}`;
    for (const [key, label] of Object.entries(PLAN_FIELDS)) {
      if (c[key] === null) add(PLAN_FAULTS.MISSING_FIELD, where, `missing field "${label}:"`);
    }
    if (c.files !== null && c.files.length === 0) add(PLAN_FAULTS.MISSING_FIELD, where, 'field "Files:" lists no path in backticks');
    if (c.notDone === '') add(PLAN_FAULTS.EMPTY_NOT_DONE, where, 'field "Not done:" is empty');
    if (c.done !== null) {
      if (!c.done.closed || c.done.code.trim() === '') add(PLAN_FAULTS.DONE_NOT_BLOCK, where, '"Done:" needs a closed, non-empty code block');
      else if (/<[A-Za-z][^<>\n]*>/.test(c.done.code)) add(PLAN_FAULTS.DONE_PLACEHOLDER, where, '"Done:" still has an unfilled <...> marker');
    }
    for (const d of c.dependsOn ?? []) {
      const ok = (typeof d === 'number' && byN.has(d)) || (typeof d === 'string' && /^#\d+$/.test(d));
      if (!ok) add(PLAN_FAULTS.UNKNOWN_DEPENDENCY, where, `"Depends on" points to "${d}", which is not a chunk, "none" or a #<n> PR`);
    }
    for (const b of c.blockedBy ?? []) {
      if (!decisionIds.has(b)) add(PLAN_FAULTS.UNKNOWN_DECISION, where, `"Blocked by" points to "${b}", which is not a decision`);
    }
  }

  // Dependency graph over existing chunks (PR references are outside the plan).
  const edges = new Map(plan.chunks.map((c) => [c.n, (c.dependsOn ?? []).filter((d) => typeof d === 'number' && byN.has(d))]));
  const reaches = (from, to) => {
    const seen = new Set();
    const stack = [...edges.get(from)];
    while (stack.length) {
      const x = stack.pop();
      if (x === to) return true;
      if (!seen.has(x)) {
        seen.add(x);
        stack.push(...edges.get(x));
      }
    }
    return false;
  };
  const cyclic = plan.chunks.map((c) => c.n).filter((n) => reaches(n, n));
  if (cyclic.length) add(PLAN_FAULTS.DEPENDENCY_CYCLE, `chunks ${cyclic.join(', ')}`, 'these chunks depend on each other in a cycle');

  for (let i = 0; i < plan.chunks.length; i++) {
    for (let j = i + 1; j < plan.chunks.length; j++) {
      const a = plan.chunks[i];
      const b = plan.chunks[j];
      const shared = (a.files ?? []).filter((f) => (b.files ?? []).includes(f));
      if (shared.length && !reaches(a.n, b.n) && !reaches(b.n, a.n)) {
        add(PLAN_FAULTS.SHARED_FILE, `chunks ${a.n} and ${b.n}`, `both touch ${shared.join(', ')} with no dependency path between them`);
      }
    }
  }

  const derived = plan.chunks.map((c) => {
    const files = c.files ?? [];
    return {
      n: c.n,
      title: c.title,
      gate: files.some((f) => matchesAny(f, gateFiles)),
      needsPablo: files.filter((f) => touchesClosedList(f, [...closedPaths])),
    };
  });
  plan.chunks.forEach((c, i) => {
    const d = derived[i];
    if (d.needsPablo.length && !(c.blockedBy ?? []).some((b) => decisionIds.has(b))) {
      add(PLAN_FAULTS.CLOSED_WITHOUT_DECISION, `chunk ${c.n}`, `touches closed paths (${d.needsPablo.join(', ')}) and has no "Blocked by:" pointing to a decision`);
    }
  });

  for (const h of plan.badDecisionHeaders) add(PLAN_FAULTS.BAD_DECISION_HEADER, `decision header "${h}"`, 'expected "### <LETTER>. <question>"');
  if (plan.decisions.length > MAX_DECISIONS) add(PLAN_FAULTS.TOO_MANY_DECISIONS, 'decisions', `${plan.decisions.length} decisions; at most ${MAX_DECISIONS}`);
  for (const d of plan.decisions) {
    const where = `decision ${d.id}`;
    if (d.options.length !== OPTIONS_PER_DECISION) add(PLAN_FAULTS.DECISION_OPTIONS, where, `${d.options.length} options; exactly ${OPTIONS_PER_DECISION} required`);
    else if (!d.options[0].endsWith('(recommended)')) add(PLAN_FAULTS.DECISION_NO_RECOMMENDED, where, 'the first option must end with "(recommended)"');
  }

  return { faults, chunks: derived };
}

export function planFaults(text, lists) {
  return checkPlan(text, lists).faults;
}

// PR-level shape: a PR that touches plans/ changes exactly one plans/<slug>.md and nothing else.
export const PLAN_DIR = 'plans/';
const PLAN_FILE = /^plans\/[a-z0-9-]+\.md$/;
const PLAN_STATUSES = ['added', 'modified'];

export const PLAN_PR_FAULTS = Object.freeze(
  Object.fromEntries([
    'PR_TRUNCATED',
    'PR_OUTSIDE_PLANS',
    'PR_NOT_ONE_PLAN',
    'PR_BAD_PLAN_NAME',
    'PR_BAD_STATUS',
    'PR_PREVIOUS_OUTSIDE',
  ].map((c) => [c, c])),
);

// files: the compare endpoint's list of {filename, previous_filename?, status}. No file under plans/ means
// this is not a plan PR and there is no fault. Returns [{code, where, message}].
export function planPrFaults(files) {
  if (!Array.isArray(files)) throw new TypeError('planPrFaults: files must be an array');
  const faults = [];
  const add = (code, where, message) => faults.push({ code, where, message });
  if (files.length >= COMPARE_LIMIT) {
    add(PLAN_PR_FAULTS.PR_TRUNCATED, 'pr', `the comparison has ${files.length} files; the endpoint truncates at ${COMPARE_LIMIT}`);
    return faults;
  }
  const inPlans = (name) => typeof name === 'string' && name.startsWith(PLAN_DIR);
  const touchesPlans = (f) => inPlans(f.filename) || inPlans(f.previous_filename);
  if (!files.some(touchesPlans)) return faults;
  const plans = files.filter(touchesPlans);
  for (const f of files.filter((x) => !touchesPlans(x))) {
    add(PLAN_PR_FAULTS.PR_OUTSIDE_PLANS, f.filename, 'a PR that touches plans/ must change nothing else');
  }
  if (plans.length !== 1) add(PLAN_PR_FAULTS.PR_NOT_ONE_PLAN, 'pr', `${plans.length} files under plans/; exactly one is required`);
  for (const f of plans) {
    if (!PLAN_FILE.test(f.filename)) add(PLAN_PR_FAULTS.PR_BAD_PLAN_NAME, f.filename, 'expected plans/<slug>.md with a slug of a-z, 0-9 and hyphens');
    if (!PLAN_STATUSES.includes(f.status)) add(PLAN_PR_FAULTS.PR_BAD_STATUS, f.filename, `status "${f.status}" is not one of ${PLAN_STATUSES.join(', ')}`);
    if (f.previous_filename !== undefined && !inPlans(f.previous_filename)) {
      add(PLAN_PR_FAULTS.PR_PREVIOUS_OUTSIDE, f.filename, `renamed from ${f.previous_filename}, which is outside plans/`);
    }
  }
  return faults;
}
