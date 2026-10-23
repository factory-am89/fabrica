// Quoted strings of a source file, for the test-duplication indicator of scripts/audit.mjs.
// lesson: vocabulary-retyped-not-imported (the indicator only counts: a signal, not a gate, and blind to copies in prose or between lib files)
// The quoted strings of a source, without line comments (a `//` after a space or at the start of a line).
const QUOTED = /(["'])((?:\\.|(?!\1)[^\\\n])*)\1/g;
export const stringsOf = (text) => [...text.replace(/(^|\s)\/\/.*$/gm, '$1').matchAll(QUOTED)].map((m) => m[2]);

// The `export const` statements of a lib file: from each such line to the next line that starts a new top-level statement.
export function exportedStrings(text) {
  const out = [];
  let inExport = false;
  for (const line of text.split('\n')) {
    if (/^\S/.test(line) && !/^[})\]]/.test(line)) inExport = line.startsWith('export const');
    if (inExport) out.push(...stringsOf(line));
  }
  return out;
}
