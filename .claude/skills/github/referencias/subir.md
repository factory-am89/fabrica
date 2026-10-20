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
   first, the edit and the push each start a `tests` run, and the run that read the old body is red (stale-HEAD check in `scripts/lib/pr-body.mjs`).
   Established in #114 (head c70533c): the builder pushed and then edited the body; two `tests` runs started in the same
   second on the same SHA, one red (run 39284981066, step "PR body has the template sections", old body) and one green
   (run 39284980072). The PR stayed `mergeable_state=unstable` and did not merge for over 40 minutes with everything else green.
   A new PR cannot exist before its first push: push, then create at once with the final body file.
5. **Push, create, edit, merge: each a STANDALONE command**, through the App:
   - `node scripts/token.mjs -- git push -u origin <branch>`
   - `node scripts/token.mjs -- gh pr create --title "<t>" --body-file <scratchpad>/body.md`
   Runbook rule, with NO machine check yet: never chain these with edits or a `cd` (one command, one result to read).
   Machine-checked: git from the main folder is denied, chained or not (`.claude/hooks/carpeta-principal.mjs`,
   lesson `git-not-from-main-folder`).
6. **Look at CI once** (rules: skill `github`, "La cuota de GitHub"): `node scripts/token.mjs -- gh pr view <n> --json statusCheckRollup`.
   The constructor App cannot rerun runs: to get a new run, push a new commit (then redo step 2 and the body).
   Rerunning a red run would not fix an old body anyway: GitHub replays it with the original event, so with the body of
   that moment (observed: the rerun of 39284981066 failed again). The only way out is a new commit (it may be empty)
   whose body is already right, and the body must name the new SHA BEFORE the push: `git commit` first (the local
   commit already has its SHA), then edit the body with that SHA, then push. If you already pushed with an old SHA in the
   body, editing the body to the right SHA fixes it (seen green in #114 after editing to ebc9fc3).
   If checks are slow to start or stay queued, look at https://www.githubstatus.com first (Actions incident on
   19 Oct 2026 from 15:49 UTC: 35-minute queues) and do not push or edit the body while there is a queue: each edit restarts runs.
7. **Revisor says no with no reason.** Ask an independent revisor agent for the reason; do not argue with the verdict.
   Do not rebase without a real conflict: check with `git merge-tree --write-tree HEAD origin/main` (exit 0 = none).
   A rebase changes the SHAs your body cites, so the body must be redone from step 2. Each entry of a lesson's `sources` follows
   `PR_SOURCE` in `scripts/lib/lessons.mjs`; do not restate it here.
   A stuck `mergeable_state=dirty` with a clean merge-tree is the one justified rebase.
8. **Arm the merge** only when `revisor` and `tests` are green: `node scripts/token.mjs -- gh pr merge <n> --auto --squash`.

Also:
- A PR that touches `plans/` must change nothing else (`PR_OUTSIDE_PLANS`, `scripts/lib/plan.mjs`).
- Parallel folders: see `~/.claude/CLAUDE.md`, "Borrar carpetas" (no `git stash`; the same goes for `git checkout .`).
