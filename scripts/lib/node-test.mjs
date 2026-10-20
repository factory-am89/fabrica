// Which files `node --test` (no arguments) runs. The patterns are copied from the Node 24 documentation
// ("Running tests from the command line", https://nodejs.org/docs/latest-v24.x/api/test.html); a copy is a risk,
// so test/triggers.test.js runs the real `node --test` in a temp folder and compares the files it ran with this answer.
// The Node 22 documentation lists the same patterns with `?(c|m)js`: the `[jt]` is Node 24, where .ts files run too.
import path from 'node:path';

const EXTENSION = '?(c|m)[jt]s';
export const NODE_TEST_PATTERNS = Object.freeze([
  `**/*.test.${EXTENSION}`,
  `**/*-test.${EXTENSION}`,
  `**/*_test.${EXTENSION}`,
  `**/test-*.${EXTENSION}`,
  `**/test.${EXTENSION}`,
  `**/test/**/*.${EXTENSION}`,
]);
// The runner never descends into node_modules. Hidden folders and files (a name starting with a dot) are skipped by the glob
// itself: test/node-test.test.js checks both on the real runner.
export const SKIPPED_FOLDER = 'node_modules';

// `rel`: a path relative to the folder where `node --test` runs, with `/` (a Windows path is refused, not converted).
export function collectedByNodeTest(rel) {
  if (typeof rel !== 'string' || rel === '' || rel.includes('\\') || path.posix.isAbsolute(rel)) {
    throw new Error(`collectedByNodeTest: ${JSON.stringify(rel)} must be a relative path with "/"`);
  }
  if (rel.split('/').includes(SKIPPED_FOLDER)) return false;
  return NODE_TEST_PATTERNS.some((pattern) => path.posix.matchesGlob(rel, pattern));
}
