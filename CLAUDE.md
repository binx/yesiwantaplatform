# CLAUDE.md

## Branching

**The base branch is `main`. Never use `master`.**

Branch, rebase, diff, and open PRs against `main`:

```
git checkout main && git pull
git checkout -b <task-name>
```

`master` no longer exists — not on the remote, and deleted locally on
2026-09-09. It was an old ancestor of `main`, fully contained in it and 57
commits behind (tip `a7a2ee0`, the pre-TypeScript storefront). If you find a
`master` in a clone, it is a stale local leftover: delete it rather than
branching from it, merging it, or diffing against it.

If a tool or agent reports the default branch as `master`, its `origin/HEAD`
symref is stale. Fix it rather than working around it:

```
git remote set-head origin --auto
```

Several sessions may be working in this repo at once (see `.claude/worktrees/`),
so always create a new branch before starting a task — do not commit onto
whatever branch happens to be checked out.

## When a task lands

**Leave the main checkout on `main`, and delete the branch you finished with.**

```
git checkout main && git pull
git worktree remove .claude/worktrees/<task-name>
git branch -d <task-name>          # -d, never -D: it refuses unmerged work
```

This is not tidiness. A checkout parked on a merged feature branch becomes the
default landing spot for every later commit that forgot to branch first, and
each one silently resurrects a branch everyone believes is finished.

`assets-dir` is the worked example, and it cost several sessions. Its real work
merged as PR #9 at 08:04 on 2026-09-09. The main checkout stayed on it, so:

```
08:05  Align the lockfile with the exact sanitize-html pin
09:17  Document main as the base branch
09:22  Document main as the base branch     # same message, five minutes later
```

— three commits onto a branch that was already done, by sessions that never
meant to be on it. Each cleanup pass correctly reported the branch as unmerged,
someone resolved that one commit, and the next stray commit revived it again.
The two identical doc commits are two separate attempts landing in the same
wrong place. Worse, the file they were adding was this one, so the rule that
would have prevented the whole loop sat on the branch the loop created, where
no session ever read it.

If a branch that should be finished keeps reappearing as unmerged, check
`git worktree list` for a checkout parked on it before assuming the merge
failed.

## Node

Run `nvm use` (Node 22, pinned in `.nvmrc`) before any npm script. System Node 18
fails with misleading "command not found" errors.
