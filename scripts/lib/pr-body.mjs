// What a PR body must contain. SECTIONS is the single definition; the template and the checks derive from it.
import { decisionFaults } from './decision.mjs';

export const SECTIONS = [
  { name: 'What changes', needs: 'always', hint: 'What this PR changes and why, in a few lines.' },
  { name: 'Evidence', needs: 'always', hint: 'Paste the output of `npm run evidence` (add `-- --focus <testfile>` for your tests); other claims need their command and output in a code block.' },
  { name: 'Red before', needs: 'tests', hint: 'How each new test was seen failing before the change (command and output). Required when a file under test/ changes.' },
  { name: 'Decisions', needs: 'always', hint: 'Write "None", or one line per decision: "- principio <n> | eligió: <x> | descartó: <y> | motivo: <class of the closed list in standards/intervention.md> o decidido"; an exception: "- excepción a principio <n> | motivo: <text> | coste: <text>".' },
  { name: 'Not verified', needs: 'always', hint: 'What you could not check. Write "Nothing" if there is nothing.' },
];

export const COMPARE_LIMIT = 300; // the compare endpoint truncates at 300 files

const TEST_PREFIX = 'test/';

// The line scripts/lib/evidence.mjs writes in the Evidence header; defined here once, evidence.mjs imports it.
export const headMark = (sha) => `HEAD ${sha}`;
const HEAD_PATTERN = /\bHEAD ([0-9a-f]{7,40})\b/g;

// commits = { shas: [oldest..newest], total } from the compare JSON. The Evidence must name the newest one.
function headFaults(content, commits) {
  if (!Array.isArray(commits.shas) || commits.shas.length === 0) throw new Error('prBodyFaults: commits.shas must be a non-empty array');
  if (commits.total !== commits.shas.length) {
    return [`commit list truncated: ${commits.shas.length} listed of ${commits.total}; the head cannot be checked`];
  }
  const head = commits.shas[commits.shas.length - 1];
  const named = [...content.matchAll(HEAD_PATTERN)].map((m) => m[1]);
  if (named.length === 0) return ['## Evidence has no "HEAD <sha>" line; paste the output of `npm run evidence`'];
  return named
    .filter((n) => !head.startsWith(n))
    .map((n) => `## Evidence is for ${n}, not for the PR head ${head.slice(0, 7)}; run \`npm run evidence\` again`);
}

function parseSections(body) {
  const text = body.replace(/<!--[\s\S]*?-->/g, '');
  const found = new Map();
  let current = null;
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^```/.test(line)) inFence = !inFence;
    const heading = !inFence && /^## (.*?)\s*$/.exec(line);
    if (heading) {
      current = { lines: [] };
      const list = found.get(heading[1]) ?? [];
      list.push(current);
      found.set(heading[1], list);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return found;
}

function hasClosedCodeBlock(content) {
  const re = /^```[^\n]*\n([\s\S]*?)^```[ \t]*$/gm;
  for (const m of content.matchAll(re)) if (m[1].trim() !== '') return true;
  return false;
}

export function prBodyFaults(body, files, commits = null) {
  if (!Array.isArray(files)) throw new Error('prBodyFaults: files must be an array');
  if (body === null || body === undefined || body === '') return ['PR body is empty'];
  const found = parseSections(String(body));
  const touchesTests = files.some((f) => String(f).startsWith(TEST_PREFIX));
  const faults = [];
  for (const { name, needs } of SECTIONS) {
    const list = found.get(name) ?? [];
    if (list.length > 1) { faults.push(`duplicate section: ## ${name}`); continue; }
    const required = needs === 'always' || touchesTests;
    if (list.length === 0) {
      if (required) faults.push(`missing section: ## ${name}`);
      continue;
    }
    const content = list[0].lines.join('\n');
    if (content.trim() === '') {
      if (required) faults.push(`empty section: ## ${name}`);
      continue;
    }
    if (name === 'Evidence' && !hasClosedCodeBlock(content)) {
      faults.push('## Evidence needs a closed, non-empty code block');
    }
    if (name === 'Evidence' && commits) faults.push(...headFaults(content, commits));
    if (name === 'Decisions') faults.push(...decisionFaults(content).map((f) => `## Decisions line ${f.line}: ${f.code}: ${f.message}`));
  }
  return faults;
}
