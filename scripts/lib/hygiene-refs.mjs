// What the skills cite, for the hygiene candidates OVERLAP and DEAD_REF (chunk 19 of plans/trabajar-solos.md): repo paths and `npm run` commands.
// A path is whatever `mechanismKind` of scripts/lib/lessons.mjs accepts (one definition of «a path of the repo»); nothing is listed twice.
// Pure except readSkills and the existence checks of deadRefs. A skill without SKILL.md or without «## Lo que falló» stops the reading (viñetas throws).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LESSONS_DIR, mechanismKind } from './lessons.mjs';
import { carpetasDeSkills, viñetas } from './skills.mjs';

export const DOC = Object.freeze({ lesson: 'lesson', skill: 'skill' });
export const REF = Object.freeze({ path: 'path', command: 'command' });
// Plain code-point order: the same on every machine (localeCompare depends on the locale).
export const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const WORD = /[\w./-]+/g;
const TRAILING_DOTS = /\.+$/;
const NPM_RUN = /\bnpm run ([\w:-]+)/g;
const REFERENCES_DIR = 'referencias';
const SKILL_FILE = 'SKILL.md';

// [{name, files: [{file, text}] (SKILL.md first, then its referencias/), bullets}] of .claude/skills/.
export function readSkills(root) {
  const rel = (f) => path.relative(root, f).split(path.sep).join('/');
  return carpetasDeSkills(root).map((carpeta) => {
    const refs = path.join(carpeta, REFERENCES_DIR);
    const paths = [path.join(carpeta, SKILL_FILE), ...(existsSync(refs) ? readdirSync(refs).sort().map((f) => path.join(refs, f)) : [])];
    const files = paths.map((f) => ({ file: rel(f), text: readFileSync(f, 'utf8') }));
    return { name: path.basename(carpeta), files, bullets: viñetas(files[0].text) };
  });
}

export const citedPaths = (text) => [...new Set([...text.matchAll(WORD)].map((m) => m[0].replace(TRAILING_DOTS, '')).filter((t) => mechanismKind(t) !== null))];

// docs: [{kind, name, cited: [path], text: string | null}] (a lesson cites its mechanism and has no text). Returns [{a, b, files}] with a < b.
// Not listed: two lessons (they share a mechanism: MERGE says it) and a skill that links the lesson (lessons/<id>.json): that link is wanted.
export function overlaps(docs) {
  const id = (d) => `${d.kind}:${d.name}`;
  const linked = (l, s) => l.kind === DOC.lesson && s.kind === DOC.skill && s.text.includes(`${LESSONS_DIR}/${l.name}.json`);
  const out = [];
  docs.forEach((x, i) => docs.slice(i + 1).forEach((y) => {
    const [a, b] = [x, y].sort((p, q) => byText(id(p), id(q)));
    const files = a.cited.filter((f) => b.cited.includes(f));
    if (files.length === 0 || (a.kind === DOC.lesson && b.kind === DOC.lesson) || linked(a, b) || linked(b, a)) return;
    out.push({ a: id(a), b: id(b), files });
  }));
  return out.sort((p, q) => byText(p.a, q.a) || byText(p.b, q.b));
}

// [{doc, file, ref, kind}]: a cited path that is not in `root`, or an `npm run <name>` that package.json does not define. Sorted.
export function deadRefs({ skills, lessons, root, scriptNames }) {
  const dead = [];
  const check = (doc, file, ref, kind) => dead.push({ doc, file, ref, kind });
  for (const s of skills) {
    for (const f of s.files) {
      for (const p of citedPaths(f.text)) if (!existsSync(path.join(root, p))) check(`${DOC.skill}:${s.name}`, f.file, p, REF.path);
      for (const name of new Set([...f.text.matchAll(NPM_RUN)].map((m) => m[1]))) if (!scriptNames.includes(name)) check(`${DOC.skill}:${s.name}`, f.file, name, REF.command);
    }
  }
  // A mechanism that is no path at all is a fault of the registry (npm run lessons), not a dead reference.
  for (const l of lessons) if (mechanismKind(l.mechanism) !== null && !existsSync(path.join(root, l.mechanism))) check(`${DOC.lesson}:${l.id}`, `${LESSONS_DIR}/${l.id}.json`, l.mechanism, REF.path);
  return dead.sort((p, q) => byText(p.doc, q.doc) || byText(p.file, q.file) || byText(p.kind, q.kind) || byText(p.ref, q.ref));
}
