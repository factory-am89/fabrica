// The single reader of the questions of a standard (standards/code.md today, a plans standard next).
// A question is a block that starts with "### <P><n> — <text>" and has a "Quién: máquina|revisor" line.
// One prefix (an uppercase letter) per file. It throws on anything malformed: a bad question is never skipped.
export const FIELDS = {
  checkedBy: { label: 'Quién', values: ['máquina', 'revisor'] },
  good: 'Bien',
  bad: 'Mal',
};

const HEADER = /^([A-Z])(\d+) — (.+)$/m;
const checkedByRe = new RegExp(`^${FIELDS.checkedBy.label}: (${FIELDS.checkedBy.values.join('|')})`, 'm');
const fieldRe = (label) => new RegExp(`^${label}: (.*)$`, 'm');

// md -> [{id, prefix, n, text, checkedBy, good, bad}] (good/bad are null when the block has no such line)
export function readQuestions(md) {
  const blocks = md.split(/^### /m).slice(1);
  if (blocks.length === 0) throw new Error('the standard has no questions (no "### " block)');
  const questions = [];
  const seen = new Set();
  for (const b of blocks) {
    const head = b.split('\n')[0];
    const id = head.match(HEADER);
    const checkedBy = b.match(checkedByRe);
    if (!id || !checkedBy) throw new Error(`malformed question: ${head}`);
    if (seen.has(id[1] + id[2])) throw new Error(`duplicate question id: ${id[1]}${id[2]}`);
    seen.add(id[1] + id[2]);
    questions.push({
      id: id[1] + id[2],
      prefix: id[1],
      n: Number(id[2]),
      text: id[3],
      checkedBy: checkedBy[1],
      good: b.match(fieldRe(FIELDS.good))?.[1] ?? null,
      bad: b.match(fieldRe(FIELDS.bad))?.[1] ?? null,
    });
  }
  const prefixes = new Set(questions.map((q) => q.prefix));
  if (prefixes.size > 1) throw new Error(`mixed prefixes in one standard: ${[...prefixes].join(', ')}`);
  return questions;
}
