-- Unipile account ownership hardening.
--
-- Both objects below already existed in the live database but had NO migration
-- in this repo, so a fresh environment came up missing the entire ownership
-- guard. `unipile_connect_snapshots` was created out of band; the unique index
-- did not exist anywhere until 2026-07-19.
--
-- Applied to the live database on 2026-07-19.

-- The pre-connect snapshot ("bind permit"). Records which Unipile accounts
-- already existed in the shared tenant when a user clicked Connect, so an
-- account appearing afterwards can be attributed to that user's connect.
-- created_at is load-bearing: the app treats a permit older than the hosted
-- link's lifetime as expired (see lib/social/connect-snapshot.ts). Without the
-- expiry, an abandoned connect left a permit that could bind an unrelated
-- account days later with no authentication at all.
CREATE TABLE IF NOT EXISTS unipile_connect_snapshots (
  user_id     uuid PRIMARY KEY,
  account_ids text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One Unipile account belongs to exactly one row, enforced by Postgres.
--
-- The application-level check was a SELECT ("is anyone else holding this id?")
-- followed by a write, which two concurrent connects both pass. Since a single
-- Unipile subscription is shared by every user, a lost race there binds one
-- person's LinkedIn to another person's account, and their posts import into
-- the wrong library. A partial unique index makes that unrepresentable: the
-- second writer now fails loudly instead of silently winning.
CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_unipile_account_id_key
  ON social_accounts (unipile_account_id)
  WHERE unipile_account_id IS NOT NULL;

-- Audit for mis-bound rows. Expected result: zero rows. Anything returned is a
-- LinkedIn account claimed by more than one user, i.e. active contamination.
-- (Verified empty on 2026-07-19: 8 accounts, 8 distinct users.)
--   SELECT unipile_account_id, count(DISTINCT user_id) AS users
--   FROM social_accounts
--   WHERE unipile_account_id IS NOT NULL
--   GROUP BY unipile_account_id
--   HAVING count(DISTINCT user_id) > 1;
