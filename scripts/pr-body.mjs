// Checks a PR body against the template. Usage:
//   node scripts/pr-body.mjs --body-file <path> (--files-file <path> | --compare-file <json>)
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { prBodyFaults, COMPARE_LIMIT } from './lib/pr-body.mjs';

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--body-file', '--files-file', '--compare-file'].includes(key) || argv[i + 1] === undefined) {
      throw new Error(`bad argument: ${key}`);
    }
    if (key in opts) throw new Error(`repeated argument: ${key}`);
    opts[key] = argv[i + 1];
  }
  return opts;
}

// Returns { files, commits }; commits is null in --files-file mode, which has no commit list.
function inputsFrom(opts) {
  const sources = ['--files-file', '--compare-file'].filter((k) => k in opts);
  if (sources.length !== 1) throw new Error('give exactly one of --files-file or --compare-file');
  if (sources[0] === '--files-file') {
    const files = readFileSync(opts['--files-file'], 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return { files, commits: null };
  }
  const data = JSON.parse(readFileSync(opts['--compare-file'], 'utf8'));
  if (!Array.isArray(data.files)) throw new Error('compare JSON has no files array');
  if (data.files.length >= COMPARE_LIMIT) throw new Error(`comparison has ${data.files.length} files; the endpoint truncates at ${COMPARE_LIMIT}`);
  if (!Array.isArray(data.commits) || data.commits.some((c) => typeof c.sha !== 'string')) throw new Error('compare JSON has no commits array with a sha each');
  const files = data.files.flatMap((f) => [f.filename, f.previous_filename].filter((x) => typeof x === 'string'));
  return { files, commits: { shas: data.commits.map((c) => c.sha), total: data.total_commits } };
}

export function run(argv, out = console.log, err = console.error) {
  try {
    const opts = parseArgs(argv);
    if (!('--body-file' in opts)) throw new Error('--body-file is required');
    const body = readFileSync(opts['--body-file'], 'utf8');
    const { files, commits } = inputsFrom(opts);
    if (!commits) err('pr-body: note: --files-file has no commit list, so the Evidence HEAD was not checked');
    const faults = prBodyFaults(body, files, commits);
    if (faults.length) {
      for (const f of faults) err(`pr-body: ${f}`);
      return 1;
    }
    out('pr-body: ok');
    return 0;
  } catch (e) {
    err(`pr-body: ${e.message}`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(run(process.argv.slice(2)));
