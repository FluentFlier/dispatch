-- One-off cleanup: remove duplicate signal_lead_contacts rows.
--
-- WHY: insertContactsForLead had no existence check and re-ran on every
-- re-scrape and on cross-source domain merges, so the same founder accumulated
-- ~4x per lead. The code path is now de-duplicated (see insertContactsForLead);
-- this removes the historical duplicates that already exist.
--
-- Policy: keep exactly one row per (lead_id, lower(trim(name))) for named
-- contacts, preferring the primary row, then the earliest created_at, then the
-- lowest id as a final tiebreak. Rows with a null/blank name are left untouched
-- so distinct URL-only contacts are never collapsed.
--
-- Apply manually (not auto-applied by this change).

DELETE FROM signal_lead_contacts AS a
USING signal_lead_contacts AS b
WHERE a.id <> b.id
  AND a.lead_id = b.lead_id
  AND a.name IS NOT NULL
  AND btrim(a.name) <> ''
  AND lower(btrim(a.name)) = lower(btrim(b.name))
  AND (
    (b.is_primary AND NOT a.is_primary)
    OR (a.is_primary = b.is_primary AND a.created_at > b.created_at)
    OR (a.is_primary = b.is_primary AND a.created_at = b.created_at AND a.id > b.id)
  );
