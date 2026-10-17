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
4. **Body before push.** The body must already cite the HEAD you are about to push. Updating an existing PR: run
   `node scripts/token.mjs -- gh pr edit <n> --body-file <scratchpad>/body.md` first, then push. If the push goes
   first, the first `tests` run is red (stale-HEAD check in `scripts/lib/pr-body.mjs`); a later run goes green.
   A new PR cannot exist before its first push: push, then create at once with the final body file.
5. **Push, create, edit, merge: each a STANDALONE command**, through the App:
   - `node scripts/token.mjs -- git push -u origin <branch>`
   - `node scripts/token.mjs -- gh pr create --title "<t>" --body-file <scratchpad>/body.md`
   Never chained (`&&`, `;`) with edits or with a `cd`, and never from the main folder: the hook
   `.claude/hooks/carpeta-principal.mjs` denies git there, chained or not.
6. **Look at CI once**, no `--watch`, no loop: `node scripts/token.mjs -- gh pr view <n> --json statusCheckRollup`.
   The constructor App cannot rerun runs: to get a new run, push a new commit (then redo step 2 and the body).
7. **Revisor says no with no reason.** Ask an independent revisor agent for the reason; do not argue with the verdict.
   Do not rebase without a real conflict: check with `git merge-tree --write-tree HEAD origin/main` (exit 0 = none).
   A rebase changes the SHAs your body cites, so the body must be redone from step 2, and a lesson whose
   `source` is `intervenciones.md:<line>` must be re-pointed if rows moved (`npm run lessons` does not catch a shifted line
   that is still a dated row). A stuck `mergeable_state=dirty` with a clean merge-tree is the one justified rebase.
8. **Arm the merge** only when `revisor` and `tests` are green: `node scripts/token.mjs -- gh pr merge <n> --auto --squash`.

Also:
- A PR that touches `plans/` must change nothing else (`PR_OUTSIDE_PLANS`, `scripts/lib/plan.mjs`).
- Never `git checkout .` or `git stash` while other folders work in parallel (the stash is shared by all of them).
