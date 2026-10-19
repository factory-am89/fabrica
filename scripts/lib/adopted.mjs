// Check of an adopted project: it must own nothing of what it inherits from the Factory (roles, skills, forges,
// bases, templates, horizontal entities). What the Factory has is read from its own repo (the .claude/ folders, the
// entity registry entities.json, apps/proyecto-nuevo/); the project is read from a folder. Faults are returned,
// never swallowed (principle 3); a project file that cannot be read fails loudly.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ENTITIES_FILE, HORIZONTAL, readEntities } from './entities.mjs';

export const ADOPTED_FAULTS = Object.freeze(
  Object.fromEntries([
    'OWN_ROLE',
    'OWN_SKILL',
    'OWN_FORGE',
    'OWN_BASE',
    'OWN_TEMPLATE',
    'REDEFINED_ENTITY',
  ].map((c) => [c, c])),
);

export const ROLES_DIR = '.claude/agents';
export const SKILLS_DIR = '.claude/skills';
export const BASE_DIR = 'base';
export const TEMPLATES_DIR = 'apps/proyecto-nuevo';
// Where a project may keep its own entity registry: the Factory's name and MenuPlan's.
export const PROJECT_REGISTRIES = [ENTITIES_FILE, 'ops/entidades.json'];
// A project role is the Factory's role under another name when it repeats at least this share of that role's
// distinct non-blank lines (the same file name is a fault without looking at the content).
export const ROLE_OVERLAP = 0.5;

const fault = (code, where, message) => ({ code, where, message });
const listDir = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []);
const files = (dir) => listDir(dir).filter((d) => d.isFile()).map((d) => d.name);

// Lower case, no accents, single spaces: «Hogar » and «hogar» are the same word.
export const normalize = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');

const rolesOf = (root) => files(path.join(root, ROLES_DIR)).filter((f) => f.endsWith('.md'));
const skillsOf = (root) => listDir(path.join(root, SKILLS_DIR)).filter((d) => d.isDirectory()).map((d) => d.name);
const roleLines = (file) => new Set(readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l !== ''));

// What the project inherits, read once from the Factory repo.
export function readInherited(factoryRoot) {
  const registry = readEntities(factoryRoot);
  const horizontal = registry.entities.filter((e) => e.scope === HORIZONTAL);
  return {
    roles: rolesOf(factoryRoot).map((f) => ({ file: f, lines: roleLines(path.join(factoryRoot, ROLES_DIR, f)) })),
    skills: skillsOf(factoryRoot),
    forges: horizontal.filter((e) => typeof e.forge === 'string').map((e) => e.forge),
    bases: files(path.join(factoryRoot, BASE_DIR)).map((f) => `${BASE_DIR}/${f}`),
    templates: files(path.join(factoryRoot, TEMPLATES_DIR)).map((f) => `${TEMPLATES_DIR}/${f}`),
    entities: horizontal.map((e) => ({ id: e.id, name: e.name, term: e.term })),
  };
}

function roleFaults(project, inherited) {
  const out = [];
  for (const file of rolesOf(project)) {
    const mine = roleLines(path.join(project, ROLES_DIR, file));
    for (const role of inherited.roles) {
      const shared = [...role.lines].filter((l) => mine.has(l)).length;
      const share = role.lines.size === 0 ? 0 : shared / role.lines.size;
      if (file === role.file) out.push(fault(ADOPTED_FAULTS.OWN_ROLE, `${ROLES_DIR}/${file}`, `has the same name as the inherited role ${role.file}`));
      else if (share >= ROLE_OVERLAP) out.push(fault(ADOPTED_FAULTS.OWN_ROLE, `${ROLES_DIR}/${file}`, `repeats ${shared} of ${role.lines.size} lines of the inherited role ${role.file}`));
    }
  }
  return out;
}

const skillFaults = (project, inherited) => skillsOf(project)
  .filter((s) => inherited.skills.includes(s))
  .map((s) => fault(ADOPTED_FAULTS.OWN_SKILL, `${SKILLS_DIR}/${s}`, `the Factory already has the skill ${s}`));

// OWN_FORGE, OWN_BASE and OWN_TEMPLATE share one rule: the project has a file at the path of an inherited one.
const copyFaults = (code, project, paths, what) => paths
  .filter((p) => existsSync(path.join(project, p)))
  .map((p) => fault(code, p, `a copy of the inherited ${what}`));

function readProjectEntities(project) {
  const found = [];
  for (const rel of PROJECT_REGISTRIES) {
    const file = path.join(project, rel);
    if (!existsSync(file)) continue;
    let data;
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`${rel} in ${project} is not readable JSON`, { cause: e });
    }
    if (!Array.isArray(data?.entities)) throw new Error(`${rel} in ${project} has no «entities» list`);
    found.push(...data.entities.map((e) => ({ ...e, file: rel })));
  }
  return found;
}

function entityFaults(project, inherited) {
  const out = [];
  for (const mine of readProjectEntities(project)) {
    for (const theirs of inherited.entities) {
      const same = [
        mine.id !== undefined && mine.id === theirs.id && 'id',
        mine.name !== undefined && normalize(mine.name) === normalize(theirs.name) && 'name',
        mine.term !== undefined && normalize(mine.term) === normalize(theirs.term) && 'term',
      ].filter(Boolean);
      if (same.length > 0) out.push(fault(ADOPTED_FAULTS.REDEFINED_ENTITY, `${mine.file}#${mine.id ?? '?'}`, `redefines the horizontal entity ${theirs.id} (same ${same.join(', ')})`));
    }
  }
  return out;
}

// The faults of the project folder `project` against what `inherited` (readInherited) says it gets.
export function adoptedFaults(project, inherited) {
  if (!existsSync(project)) throw new Error(`the project folder ${project} does not exist`);
  return [
    ...roleFaults(project, inherited),
    ...skillFaults(project, inherited),
    ...copyFaults(ADOPTED_FAULTS.OWN_FORGE, project, inherited.forges, 'forge'),
    ...copyFaults(ADOPTED_FAULTS.OWN_BASE, project, inherited.bases, 'base'),
    ...copyFaults(ADOPTED_FAULTS.OWN_TEMPLATE, project, inherited.templates, 'template'),
    ...entityFaults(project, inherited),
  ];
}

// Starting figures: what the project has next to what is inherited, and the faults counted per code.
export function adoptedSummary(project, inherited) {
  const faults = adoptedFaults(project, inherited);
  return {
    roles: rolesOf(project).length,
    skills: skillsOf(project).length,
    entities: readProjectEntities(project).length,
    byFault: Object.fromEntries(Object.values(ADOPTED_FAULTS).map((c) => [c, faults.filter((f) => f.code === c).length])),
    faults,
  };
}
