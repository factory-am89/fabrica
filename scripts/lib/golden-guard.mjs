// The brake on the golden corpus (chunk 10 of the self-learning plan). A PR that weakens the reviewer corpus
// (test/fixtures/golden/review/) makes the judge say no, with a closed reason; Pablo's Approve on the head overrides it
// like any other no (scripts/veredicto.mjs). Weakening is three things, and only these:
//   - a case is gone (its entry in expected.json, or its pr.diff / body.md);
//   - a case expected to be caught (`expect` is a question id) now expects `clean`;
//   - the floor file (floor.json, the --floor of scripts/golden.mjs) is lower: a detection rate down or dropped, falsosNo up, or the file gone.
// A new case, a new `expect` or a higher floor are NOT weakening: they never stop a PR (0% HITL).
// This code runs from main inside the judge (pull_request_target) and only READS the PR through the API: it runs no PR code.
// Reasons are closed: a code plus, at most, an id that matches SAFE_ID; nothing of the PR's text reaches the check.
export const GOLDEN_DIR = 'test/fixtures/golden/review';
export const EXPECTED_FILE = 'expected.json';
export const FLOOR_FILE = 'floor.json';
export const CLEAN = 'clean';
export const CASE_FILES = ['pr.diff', 'body.md'];
// The compare API lists at most 300 files; at that size the list may be cut and the brake cannot see everything.
export const COMPARE_FILE_LIMIT = 300;
export const FAULT = { deleted: 'caso borrado', lowered: 'expect rebajado de no a clean', floor: 'suelo rebajado', unreadable: 'no se pudo comprobar' };
const PREFIX = 'corpus dorado';
const SAFE_ID = /^[A-Za-z0-9_.-]{1,40}$/;

export const plain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const fault = (what, id) => (id === undefined ? `${PREFIX}: ${what}` : `${PREFIX}: ${what} (${SAFE_ID.test(id) ? id : 'nombre no válido'})`);

// Every path the compare names (new name and, for a rename, the old one).
const pathsOf = (files) => files.flatMap((f) => [f.filename, f.previous_filename].filter((p) => typeof p === 'string'));
export const touchesCorpus = (files) => pathsOf(files).some((p) => p.startsWith(`${GOLDEN_DIR}/`));

// Cases whose pr.diff or body.md leaves the folder in this compare (removed, or renamed away).
function casesLosingFiles(files) {
  const lost = new Set();
  const prefix = `${GOLDEN_DIR}/`;
  for (const f of files) {
    const gone = f.status === 'removed' ? f.filename : f.status === 'renamed' ? f.previous_filename : null;
    if (typeof gone !== 'string' || !gone.startsWith(prefix)) continue;
    const [id, name, ...rest] = gone.slice(prefix.length).split('/');
    if (id && rest.length === 0 && CASE_FILES.includes(name)) lost.add(id);
  }
  return lost;
}

// expected: the parsed expected.json or null when the file is absent; floor: the parsed floor.json or null.
function expectedOf(side, label) {
  if (side.expected === null) return null;
  if (!plain(side.expected)) throw new Error(`${label}: expected.json must be an object`);
  for (const [id, e] of Object.entries(side.expected)) if (!plain(e) || typeof e.expect !== 'string') throw new Error(`${label}: ${id} has no expect`);
  return side.expected;
}

// The shape of a floor file, written once: scripts/golden.mjs (belowFloor) validates with it too. Throws with the message it gives.
export function checkFloorShape(floor) {
  if (!plain(floor) || Object.keys(floor).sort().join() !== 'deteccion,falsosNo') throw new Error('floor: must have exactly deteccion and falsosNo');
  const inRange = (x) => typeof x === 'number' && x >= 0 && x <= 1;
  if (!plain(floor.deteccion) || !inRange(floor.falsosNo) || !Object.values(floor.deteccion).every(inRange)) throw new Error('floor: values must be numbers between 0 and 1');
  return floor;
}

function floorOf(side, label) {
  if (side.floor === null) return null;
  try {
    return checkFloorShape(side.floor);
  } catch (e) {
    throw new Error(`${label}: floor.json is malformed (${e.message})`);
  }
}

// files: the compare's files. base, head: { expected, floor } read at the base and at the head of the PR.
// Returns the list of closed reasons (empty when nothing is weakened). Throws when a side is malformed: the caller turns that into a no.
export function goldenFaults({ files, base, head }) {
  if (!Array.isArray(files)) throw new Error('goldenFaults: files must be a list');
  if (!touchesCorpus(files)) return [];
  const out = [];
  const before = expectedOf(base, 'base');
  const after = expectedOf(head, 'head');
  if (before) {
    const lost = casesLosingFiles(files);
    for (const id of Object.keys(before)) {
      if (!after || !(id in after) || lost.has(id)) out.push(fault(FAULT.deleted, id));
      else if (before[id].expect !== CLEAN && after[id].expect === CLEAN) out.push(fault(FAULT.lowered, id));
    }
  }
  const floorBefore = floorOf(base, 'base');
  const floorAfter = floorOf(head, 'head');
  if (floorBefore) {
    if (!floorAfter) out.push(fault(FAULT.floor, FLOOR_FILE));
    else {
      if (floorAfter.falsosNo > floorBefore.falsosNo) out.push(fault(FAULT.floor, 'falsosNo'));
      for (const [id, min] of Object.entries(floorBefore.deteccion)) if (!(id in floorAfter.deteccion) || floorAfter.deteccion[id] < min) out.push(fault(FAULT.floor, id));
    }
  }
  return out;
}

// The whole check. listFiles() -> the compare's files; read(ref, relativePath) -> the file's text or null when it does not exist there.
// base and head are the commits of the PR. Anything unreadable is a reason (never a pass).
export async function checkGolden({ listFiles, read, base, head }) {
  try {
    const files = await listFiles();
    if (!Array.isArray(files)) throw new Error('the compare has no file list');
    if (files.length >= COMPARE_FILE_LIMIT) throw new Error('the compare may be cut at its file limit');
    if (!touchesCorpus(files)) return [];
    const side = async (ref) => {
      const json = async (name) => {
        const text = await read(ref, `${GOLDEN_DIR}/${name}`);
        return text === null ? null : JSON.parse(text);
      };
      return { expected: await json(EXPECTED_FILE), floor: await json(FLOOR_FILE) };
    };
    return goldenFaults({ files, base: await side(base), head: await side(head) });
  } catch (e) {
    console.error(`golden-guard: ${e.message}`);
    return [fault(FAULT.unreadable)];
  }
}
