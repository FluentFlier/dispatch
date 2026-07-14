-- Live Memory: backfill idempotency markers
--
-- Adds a `memory_synced_at` column to each table whose rows are written into
-- semantic memory. The backfill (scripts/backfill-memory.ts) pages rows WHERE
-- memory_synced_at IS NULL and stamps it on success, so re-runs skip done rows
-- and unchanged content is never re-embedded on every pass.
--
-- Live writes (publish / import / edit / event answers / story capture) key on
-- customId and upsert, so they do not need this column - it exists only to bound
-- the one-time historical backfill.
--
-- Safe to run multiple times.

ALTER TABLE posts          ADD COLUMN IF NOT EXISTS memory_synced_at timestamptz;
ALTER TABLE event_captures ADD COLUMN IF NOT EXISTS memory_synced_at timestamptz;
ALTER TABLE story_bank     ADD COLUMN IF NOT EXISTS memory_synced_at timestamptz;

-- Partial indexes so the backfill's "not yet synced" scan stays cheap on large
-- historical tables.
CREATE INDEX IF NOT EXISTS idx_posts_memory_unsynced
  ON posts (id) WHERE memory_synced_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_event_captures_memory_unsynced
  ON event_captures (id) WHERE memory_synced_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_story_bank_memory_unsynced
  ON story_bank (id) WHERE memory_synced_at IS NULL;
