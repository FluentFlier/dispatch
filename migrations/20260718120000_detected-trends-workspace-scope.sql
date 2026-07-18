-- detected_trends: scope trends per (user_id, workspace_id, topic) instead of
-- per (user_id, topic). Without the workspace in the key, a creator's client
-- workspaces shared one trend row per topic and bled across into each other
-- (e.g. an automotive client's trend showing in a founder workspace). The
-- upsert in src/lib/trends/detect.ts now targets this 3-column key.
--
-- Safe: the old (user_id, topic) unique already guaranteed no duplicate topics
-- per user, so every row is trivially unique under the wider key too. Existing
-- rows were backfilled with workspace_id by db/multi-tenancy.sql.

ALTER TABLE detected_trends DROP CONSTRAINT IF EXISTS detected_trends_user_topic_key;

CREATE UNIQUE INDEX IF NOT EXISTS detected_trends_user_ws_topic_key
  ON detected_trends (user_id, workspace_id, topic);
