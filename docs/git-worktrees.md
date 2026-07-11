# Git worktrees

Worktrees let you check out several branches at once (parallel agents, reviews,
experiments) without a second clone. **Keep every worktree OUTSIDE the repo** —
in a sibling `../yunoball-worktrees/` directory. Never nest a worktree inside
`yunoball/` (a nested worktree pollutes the repo and can be accidentally
committed).

## Layout

```
projects/
├── yunoball/                  # primary repository
└── yunoball-worktrees/
    ├── feat/                  # one directory per branch (dir name = branch slug)
    ├── review-<pr>/
    └── experiment-<name>/
```

## Create

New branch off `origin/main`:

```bash
git fetch origin
git worktree add ../yunoball-worktrees/<branch-slug> -b <branch-name> origin/main
```

Existing branch:

```bash
git worktree add ../yunoball-worktrees/<branch-slug> <branch-name>
```

`.env` is gitignored, so seed it and install deps in the new worktree:

```bash
cp .env ../yunoball-worktrees/<branch-slug>/.env
cd ../yunoball-worktrees/<branch-slug> && pnpm install
```

## Remove

```bash
git worktree remove ../yunoball-worktrees/<branch-slug>
git worktree prune
```

## Move a misplaced worktree (e.g. one nested in the repo)

```bash
mkdir -p ../yunoball-worktrees
git worktree move <old-path> ../yunoball-worktrees/<branch-slug>
```

Run it from a directory **outside** the worktree being moved so your shell's
working directory isn't invalidated mid-move. `git worktree move` carries
`.env`, `node_modules`, and the git registry along in one atomic step.

## Rules

- **Never** create a worktree inside the primary repo — not in `.claude/`, not anywhere.
- All worktrees live in `../yunoball-worktrees/`.
- One branch = one worktree (git enforces this).
- Use descriptive branch and directory names (dir name = branch slug).
- Remove with `git worktree remove` — never `rm -rf` a worktree before deregistering it, or you leave stale metadata (`git worktree prune` cleans that up).
- Don't commit dependencies, build output, secrets, or agent runtime state — `.claude/` is gitignored.
