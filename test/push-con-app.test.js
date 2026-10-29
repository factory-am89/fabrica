// Hook push-con-app: git push y gh pr create/edit/merge solo van envueltos en scripts/token.mjs --.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decidir } from '../.claude/hooks/push-con-app.mjs';

const HOOK = fileURLToPath(new URL('../.claude/hooks/push-con-app.mjs', import.meta.url));
const bash = (command, cwd = 'C:\\dev\\MenuPlan-algo') => decidir({ tool_name: 'Bash', tool_input: { command }, cwd });

test('niega el push y el PR sin la identidad de la App, y el mensaje da la orden correcta', () => {
  const malas = [
    'git push',
    'git push -u origin fix/x',
    'git -C C:\\dev\\homenu-panel-uno push origin x',
    'git -c user.name=a push',
    'cd C:\\dev\\MenuPlan-algo && git push -u origin feat/y',
    'git status; git push',
    'GIT_TRACE=1 git push',
    'env X=1 git push',
    'bash -c "git push origin x"',
    'gh pr create --fill',
    'gh pr edit 3 --body-file b.md',
    'gh pr merge 3 --auto --squash',
    'gh --repo a/b pr merge 3',
    'echo hola\ngit push',
    '"C:\\Program Files\\Git\\cmd\\git.exe" push',
  ];
  for (const orden of malas) {
    const motivo = bash(orden);
    assert.ok(motivo, `debía negar: ${orden}`);
    assert.match(motivo, /node scripts\/token\.mjs -- /);
  }
});

test('deja pasar lo envuelto en token.mjs, la lectura y los textos que solo mencionan la orden', () => {
  const buenas = [
    'node scripts/token.mjs -- git push -u origin fix/x',
    'node C:\\dev\\fabrica\\scripts\\token.mjs -- git push',
    'FABRICA_REPO=pabloam89/MenuPlan node C:/dev/fabrica/scripts/token.mjs -- gh pr create --fill',
    'node scripts/token.mjs -- gh pr merge 3 --auto --squash',
    'gh pr view 3',
    'gh pr checks 3',
    'gh pr diff 3',
    'gh pr list',
    'git status',
    'git pull --ff-only',
    'git log --oneline',
    'git fetch origin',
    'echo "git push"',
    'git commit -m "no hago git push ni gh pr merge"',
    'grep -n "gh pr create" CLAUDE.md',
    "cat > f.md <<'EOF'\nluego git push\nEOF",
    'npm run tarea -- fix/push-solo-con-app',
    'git config alias.push x',
  ];
  for (const orden of buenas) assert.equal(bash(orden), null, `debía pasar: ${orden}`);
  assert.equal(decidir({ tool_name: 'Edit', tool_input: { file_path: 'a' } }), null);
});

test('el hook de verdad: deny por stdout, nada si pasa, y falla en alto si no entiende la entrada', () => {
  const lanzar = (input) => spawnSync('node', [HOOK], { input, encoding: 'utf8' });
  const malo = lanzar(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: 'C:\\dev\\MenuPlan-x' }));
  assert.equal(malo.status, 0, malo.stderr);
  assert.equal(JSON.parse(malo.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const bueno = lanzar(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'node scripts/token.mjs -- git push' } }));
  assert.equal(bueno.stdout.trim(), '');
  assert.equal(JSON.parse(lanzar('no es json').stdout).hookSpecificOutput.permissionDecision, 'deny');
});
