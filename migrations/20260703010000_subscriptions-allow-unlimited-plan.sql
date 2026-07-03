-- Allow the internal 'unlimited' comp tier on subscriptions.plan
--
-- WHY: entitlements.ts added an 'unlimited' PlanId (uncapped comp tier for founder
-- and demo accounts, not purchasable). The subscriptions_plan_check constraint
-- only permitted free/starter/growth/pro, so writing plan='unlimited' failed with
-- a check-constraint violation. This widens the allowed set. Idempotent.

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan = ANY (ARRAY['free', 'starter', 'growth', 'pro', 'unlimited']));
