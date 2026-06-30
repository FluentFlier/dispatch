-- ============================================================================
-- Backfill workspace_id on legacy rows created before the workspace system.
--
-- WHY: Many rows predate the multi-tenant migration and have workspace_id = NULL.
-- Today this is benign (every user is solo and the app falls back to user_id
-- scope), but once workspace-scoped RLS / workspace switching goes live, the
-- app's `.eq('workspace_id', ws)` filters will hide every unstickered row,
-- silently emptying voice, brain, ideas, etc. for affected users.
--
-- SAFETY (why this is not a blind assign):
--   * Only touches rows where workspace_id IS NULL (never overwrites a value).
--   * Only assigns when the owner belongs to EXACTLY ONE workspace, so the
--     target is unambiguous. Users with 0 workspaces (e.g. the synthetic
--     00000000-... test row) or >1 workspace are intentionally skipped — there
--     is no single correct answer for them.
--   * Idempotent: re-running changes nothing once NULLs are filled (0 rows match).
--
-- Cross-checked 2026-06-30 against live InsForge: 0 rows owned by a multi-
-- workspace user, 1 row (usage_counters test stub) owned by a 0-workspace user.
-- Every other NULL row maps to exactly one workspace.
-- ============================================================================

-- Reusable predicate: the owner has exactly one workspace membership.
-- We assign that single workspace_id to the row.

UPDATE creator_profile t
SET workspace_id = m.workspace_id
FROM workspace_members m
WHERE t.workspace_id IS NULL
  AND m.user_id = t.user_id
  AND (SELECT count(*) FROM workspace_members mm WHERE mm.user_id = t.user_id) = 1;

UPDATE creator_brain_pages t
SET workspace_id = m.workspace_id
FROM workspace_members m
WHERE t.workspace_id IS NULL
  AND m.user_id = t.user_id
  AND (SELECT count(*) FROM workspace_members mm WHERE mm.user_id = t.user_id) = 1;

UPDATE posts t
SET workspace_id = m.workspace_id
FROM workspace_members m
WHERE t.workspace_id IS NULL
  AND m.user_id = t.user_id
  AND (SELECT count(*) FROM workspace_members mm WHERE mm.user_id = t.user_id) = 1;

UPDATE content_ideas t
SET workspace_id = m.workspace_id
FROM workspace_members m
WHERE t.workspace_id IS NULL
  AND m.user_id = t.user_id
  AND (SELECT count(*) FROM workspace_members mm WHERE mm.user_id = t.user_id) = 1;

UPDATE user_settings t
SET workspace_id = m.workspace_id
FROM workspace_members m
WHERE t.workspace_id IS NULL
  AND m.user_id = t.user_id
  AND (SELECT count(*) FROM workspace_members mm WHERE mm.user_id = t.user_id) = 1;

UPDATE usage_counters t
SET workspace_id = m.workspace_id
FROM workspace_members m
WHERE t.workspace_id IS NULL
  AND m.user_id = t.user_id
  AND (SELECT count(*) FROM workspace_members mm WHERE mm.user_id = t.user_id) = 1;

UPDATE subscriptions t
SET workspace_id = m.workspace_id
FROM workspace_members m
WHERE t.workspace_id IS NULL
  AND m.user_id = t.user_id
  AND (SELECT count(*) FROM workspace_members mm WHERE mm.user_id = t.user_id) = 1;
