-- Add company_detail jsonb to signal_leads (idempotent)
--
-- WHY: the richest company context (long description, team size, industries,
-- location, stage) was fetched live per card view and then discarded - never
-- persisted, never fed to the outreach draft model. Persisting it once lets the
-- draft prompt reference real substance (description + headcount + industry)
-- without a re-scrape on every draft.
--
-- Seeded from the Algolia hit at ingest (description + industries), then
-- completed once from the YC detail page at first draft; a `fetchedAt` marker
-- inside the object means the full detail-page fetch already ran, so repeat
-- drafts reuse it instead of scraping again.

ALTER TABLE signal_leads
  ADD COLUMN IF NOT EXISTS company_detail jsonb NOT NULL DEFAULT '{}'::jsonb;
