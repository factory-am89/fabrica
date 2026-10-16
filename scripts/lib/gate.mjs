// Files whose change alters the merge gate (the `tests` and `revisor` checks). A change to any of
// them is judged by the gate as it is on main, so a broken change can lock main: it needs extra care.
// Paths are relative to the repo root.
export const GATE_FILES = [
  '.github/workflows/revisor.yml', // defines the `revisor` check and downloads the judge
  '.github/workflows/tests.yml', // defines the `tests` check (also reusable by other repos)
  'scripts/veredicto.mjs', // turns the reviewer output into the verdict; run from .fabrica/
  'estandares/codigo.md', // the questions the verdict is built from; read by veredicto.mjs
  '.claude/agents/revisor.md', // the reviewer role the revisor.yml prompt tells Claude to follow
  'eslint.config.js', // lint rules tests.yml applies (C1, C3), also to calling repos
  'test/workflows.test.js', // machine rules (C4) tests.yml runs from .fabrica/
  'scripts/lib/acciones.mjs', // C4 rule imported by test/workflows.test.js
  'scripts/lib/repo.mjs', // imported by scripts/lib/acciones.mjs
];
