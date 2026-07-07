-- Add LinkedIn verification flags to signal_lead_contacts (idempotent)
--
-- WHY: contact LinkedIn URLs are read straight from source data (YC detail
-- pages, TinyFish, Apify) and never checked, so a stale/renamed profile can
-- 404 ("profile not found") yet still be presented as a ready contact. These
-- columns record whether the founder's LinkedIn was confirmed against the
-- workspace's connected Unipile account at resolve time, so the UI can surface
-- verified vs unverified and outreach never treats an unchecked URL as trusted.
--
-- Default false: every existing row starts unverified until it is re-resolved.
-- Verification is one people-search call at resolve time (never per render).

ALTER TABLE signal_lead_contacts
  ADD COLUMN IF NOT EXISTS linkedin_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS linkedin_verified_at timestamptz NULL;
