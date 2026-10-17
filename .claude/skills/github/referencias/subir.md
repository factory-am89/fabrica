# Push and open a PR (runbook)

Run from your own task folder (`npm run tarea -- <branch>`), never from the main folder. Each step is its own command.
Scratch files (body, file list) go to your own scratchpad, never to a shared `/tmp`.

1. **Green locally.** `npm run done` -> last line `done: ok`.
2. **Evidence at the FINAL commit.** Commit everything first: `npm run evidence -- --out <scratchpad>/evidence.md`
   (add `--focus <testfile>` per new test). It refuses a dirty tree and writes `HEAD <sha>` itself. Paste its block
   as is; type no counts by hand. Any new commit after this (even a fix-up) makes the block stale: run it again.
3. **Write the PR body** from `.github/pull_request_template.md` and validate it:
   `git diff --name-only origin/main...HEAD > <scratchpad>/files.txt`, then
   `node scripts/pr-body.mjs --body-file <scratchpad>/body.md --files-file <scratchpad>/files.txt` -> `pr-body: ok`.
   `--files-file` does NOT check the Evidence HEAD (it prints a note saying so); only CI's `--compare-file` does.
   Check it by hand: the `HEAD <sha>` line of the body must equal `git rev-parse --short HEAD`.
4. **Body before push.** The body must already cite the HEAD you are about to push. Updating an existing PR: run
   `node scripts/token.mjs -- gh pr edit <n> --body-file <scratchpad>/body.md` first, then push. If the push goes
   first, the first `tests` run is red (stale-HEAD check in `scripts/lib/pr-body.mjs`) and a later run goes green.
   This was observed once (reported by the coordinating session for #38; I could not confirm it from the PR text) and not reproduced since: treat it as likely, not established.
   A new PR cannot exist before its first push: push, then create at once with the final body file.
5. **Push, create, edit, merge: each a STANDALONE command**, through the App:
   - `node scripts/token.mjs -- git push -u origin <branch>`
   - `node scripts/token.mjs -- gh pr create --title "<t>" --body-file <scratchpad>/body.md`
   Runbook rule, with NO machine check yet: never chain these with edits or a `cd` (one command, one result to read).
   Machine-checked: git from the main folder is denied, chained or not (`.claude/hooks/carpeta-principal.mjs`,
   lesson `git-not-from-main-folder`).
6. **Look at CI once** (rules: skill `github`, "La cuota de GitHub"): `node scripts/token.mjs -- gh pr view <n> --json statusCheckRollup`.
   The constructor App cannot rerun runs: to get a new run, push a new commit (then redo step 2 and the body).
7. **Revisor says no with no reason.** Ask an independent revisor agent for the reason; do not argue with the verdict.
   Do not rebase without a real conflict: check with `git merge-tree --write-tree HEAD origin/main` (exit 0 = none).
   A rebase changes the SHAs your body cites, so the body must be redone from step 2. A lesson `source` follows
   `PR_SOURCE` in `scripts/lib/lessons.mjs`; do not restate it here.
   A stuck `mergeable_state=dirty` with a clean merge-tree is the one justified rebase.
8. **Arm the merge** only when `revisor` and `tests` are green: `node scripts/token.mjs -- gh pr merge <n> --auto --squash`.

Also:
- A PR that touches `plans/` must change nothing else (`PR_OUTSIDE_PLANS`, `scripts/lib/plan.mjs`).
- Parallel folders: see `~/.claude/CLAUDE.md`, "Borrar carpetas" (no `git stash`; the same goes for `git checkout .`).
