// What an agent needs to orchestrate the scripts without a human: one exit code per failure class,
// a closed vocabulary for the result of `retire`, and the shared --json / exit-code plumbing.
// The map and the vocabulary live only here; scripts and tests import them.

// scripts/token.mjs keeps its own exit codes in MOTIVOS; unifying them with EXIT is a separate piece.
export const EXIT = Object.freeze({
  OK: 0,
  UNEXPECTED: 1, // anything not classified below (a bug: look at stderr)
  USAGE: 2, // a required argument is missing
  INVALID_BRANCH: 10, // tarea: the branch name is not feat/, fix/ or ops/ + a kebab-case name
  FOLDER_EXISTS: 11, // tarea: the work folder already exists
  GIT_FAILED: 12, // a git command failed or git could not be started
  INSTALL_FAILED: 13, // tarea: npm ci failed (folder and branch exist)
  NOT_FOUND: 20, // retire: there is no such work folder
  DETACHED_HEAD: 21, // retire: the folder has no branch
  INSIDE_FOLDER: 22, // retire: launched from inside the folder it would delete
  UNSAVED_CHANGES: 23, // retire: the folder has uncommitted changes
  NOT_MERGED: 24, // retire: the branch is not merged into main
  GH_FAILED: 25, // retire: GitHub could not be asked about the merged PR
  NODE_MODULES_SHARED: 26, // retire: another folder's node_modules junction points into this one
  DONE_LINT_FAILED: 30, // done: npm run lint failed
  DONE_TESTS_FAILED: 31, // done: npm test failed
  LESSON_FAULTS: 40, // lessons: the registry has at least one fault (the codes are in the output)
});

// Result of `retire --json`: either the folder was removed or the command refused (see `error`).
export const RETIRE_RESULT = Object.freeze({ REMOVED: 'removed', REFUSED: 'refused' });

// An error that carries its failure class; the message stays human text.
export class ExitError extends Error {
  constructor(key, message) {
    super(message);
    if (!Object.hasOwn(EXIT, key) || EXIT[key] === EXIT.OK) throw new Error(`ExitError: unknown failure class «${key}»`);
    this.key = key;
    this.exit = EXIT[key];
  }
}

// Runs one command and returns { code, stdout, stderr } without printing or exiting (testable).
//   run(args) returns the data object; human(data) its human line(s).
// Without --json: human text on stdout, errors on stderr (as before).
// With --json: one JSON object on stdout and nothing else; human text and errors on stderr.
export function runCommand(argv, { run, human, refused = {} }) {
  const json = argv.includes('--json');
  const args = argv.filter((a) => a !== '--json');
  try {
    const data = run(args);
    if (!json) return { code: EXIT.OK, stdout: `${human(data)}\n`, stderr: '' };
    return { code: EXIT.OK, stdout: `${JSON.stringify({ ok: true, ...data })}\n`, stderr: `${human(data)}\n` };
  } catch (e) {
    const key = e instanceof ExitError ? e.key : 'UNEXPECTED';
    const stderr = `${e.message}\n`;
    if (!json) return { code: EXIT[key], stdout: '', stderr };
    return { code: EXIT[key], stdout: `${JSON.stringify({ ...refused, ok: false, error: key, exit: EXIT[key] })}\n`, stderr };
  }
}

// For the `if (main)` block of a script: print and exit with the code.
export function finish({ code, stdout, stderr }) {
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  process.exit(code);
}
