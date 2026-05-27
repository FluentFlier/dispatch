# Repo structure cleanup — completed 2026-05-26

> Project renamed **content-os** → **Dispatch**. GitHub: **https://github.com/FluentFlier/dispatch** (renamed repo). Default branch: **main** (after sync).

## What was done

1. Tag `pre-flatten-20260526` on old HEAD before flatten (rollback point).
2. `git filter-repo --subdirectory-filter content-os` on a mirror (removed Ada sidecars and nested folder).
3. Branch `repo-flatten-preview` used for smoke test, then `feature/content-os` updated.
4. Flat tree verified with `npm ci && npm run build`.
5. Dispatch rebrand: `package.json` name, README, docs, `.factory` path hygiene.

## GitHub root (after flatten)

`package.json`, `src/`, `vercel.json`, `db/`, `docs/` at repository root.

## Rollback (pre-flatten tree)

```bash
git fetch origin pre-flatten-20260526
git reset --hard pre-flatten-20260526
git push --force origin HEAD:main
```

## Ops follow-up

- **Vercel:** Root Directory = `.` (clear the old `content-os` subfolder if still set).
- **Superconductor:** `sc worktree set-target-branch main` if this worktree should track `main`.
