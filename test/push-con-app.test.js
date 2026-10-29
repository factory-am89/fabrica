// Hook push-con-app: git push y gh pr create/edit/merge solo van envueltos en scripts/token.mjs --.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

test('.claude/settings.json registra el hook para Bash y PowerShell, y la orden registrada niega de verdad', () => {
  const ajustes = JSON.parse(readFileSync(new URL('../.claude/settings.json', import.meta.url), 'utf8'));
  const entradas = ajustes.hooks.PreToolUse.filter((e) => e.hooks.some((h) => h.command.includes('push-con-app.mjs')));
  assert.equal(entradas.length, 1, 'push-con-app.mjs debe estar registrado una vez en PreToolUse');
  assert.equal(entradas[0].matcher, 'Bash|PowerShell');
  // La orden tal como la lanza Claude Code (con $CLAUDE_PROJECT_DIR puesto), no llamando a decidir().
  const raiz = fileURLToPath(new URL('..', import.meta.url));
  const orden = entradas[0].hooks[0].command.replace('$CLAUDE_PROJECT_DIR', raiz.replace(/[\/]$/, ''));
  const r = spawnSync(orden, { shell: true, input: JSON.stringify({ tool_name: 'PowerShell', tool_input: { command: 'git push' } }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: raiz } });
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny', r.stderr);
});
