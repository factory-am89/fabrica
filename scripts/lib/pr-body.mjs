// What a PR body must contain. SECTIONS is the single definition; the template and the checks derive from it.
export const SECTIONS = [
  { name: 'What changes', needs: 'always', hint: 'What this PR changes and why, in a few lines.' },
  { name: 'Evidence', needs: 'always', hint: 'Each claim with the command and its output, pasted inside a code block.' },
  { name: 'Red before', needs: 'tests', hint: 'How each new test was seen failing before the change (command and output). Required when a file under test/ changes.' },
  { name: 'Not verified', needs: 'always', hint: 'What you could not check. Write "Nothing" if there is nothing.' },
];

const TEST_PREFIX = 'test/';

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

export function prBodyFaults(body, files) {
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
  }
  return faults;
}
