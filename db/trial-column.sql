-- App-managed 7-day free trial (no Stripe subscription required).
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
