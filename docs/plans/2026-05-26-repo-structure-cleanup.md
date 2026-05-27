# Repo Structure Cleanup — Completed 2026-05-26

> Follow-up: project renamed **content-os** → **Dispatch**; GitHub repo → `FluentFlier/dispatch`.

## What was done

1. Tag `pre-flatten-20260526` on old HEAD `6dad717` (rollback point).
2. `git filter-repo --subdirectory-filter content-os` on mirror.
3. Preview branch `repo-flatten-preview` pushed.
4. `feature/content-os` force-pushed to flattened history (`a9ef53d`).
5. Build verified on flat tree (`npm ci && npm run build`).

## GitHub root (after)

`package.json`, `src/`, `vercel.json`, `db/`, `docs/` — no `ada-imessages/`, no `ada-chrome-extension-main/`, no nested `content-os/`.

## Rollback

```bash
git fetch origin pre-flatten-20260526
git reset --hard pre-flatten-20260526
git push --force origin HEAD:feature/content-os
```

## Follow-up (manual)

- **Vercel:** Project Settings → Root Directory: clear or set to `.` (was `content-os`).
- **Open PRs:** Re-open against flat `feature/content-os` (old PR SHAs are invalid).
- **Ada Chrome:** Publish `hackathons/ada-chrome-extension-main/` to `Ada-The-AI-Secretary-For-Phones/ada-chrome-extension` (repo does not exist yet).
- **Ada iMessage:** Use `Ada-The-AI-Secretary-For-Phones/ada-imessage` only; drop monorepo copy.
- **Local:** Prefer single clone at `content-os/content-os` (now flat). Parent `hackathons/` still has many untracked siblings — do not treat as Content OS root.
