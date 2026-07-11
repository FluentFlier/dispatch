-- Final-review blocker B3. Follow-up to 20260711120500_hook-usage-fns.sql.
--
-- Both functions were invoker-rights (Postgres default). `authenticated` only
-- has SELECT on hook_arms/hook_examples (RLS: *_auth_read policies in
-- 20260711120000_niches-and-hook-arms.sql; the only UPDATE-capable policy is
-- FOR ALL TO project_admin). User-path generate routes call
-- increment_hook_usage() via the authenticated client, so its UPDATEs matched
-- zero rows under RLS and silently no-op'd - verified live
-- (SELECT prosecdef FROM pg_proc WHERE proname = 'increment_hook_usage' -> false
-- before this migration).
--
-- Fix: SECURITY DEFINER + SET search_path = public so both functions run as
-- their owner, which is not subject to the authenticated-role RLS gap (same
-- bypass the table owner already has), and can't be search-path-hijacked by a
-- caller-controlled search_path.
--
-- decrement_hook_uses is only ever called from the weekly hooks-refresh cron
-- via the service-role client (getServiceClient()), which already runs as
-- project_admin and bypasses RLS - so it was not actually broken. It is made
-- SECURITY DEFINER here anyway for consistency and defense-in-depth (stays
-- correct even if a future caller invokes it from a user-scoped client), not
-- because it is currently failing.
--
-- Bounded-counter risk (SECURITY DEFINER widens who can bump these counters)
-- is accepted per reviewer adjudication: worst case is an inflated
-- pulls/internal_uses_7d count, not a data-integrity or auth bypass issue.

CREATE OR REPLACE FUNCTION increment_hook_usage(p_picks JSONB)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pick JSONB;
BEGIN
  FOR pick IN SELECT * FROM jsonb_array_elements(p_picks) LOOP
    UPDATE hook_arms SET pulls = pulls + 1, updated_at = now()
      WHERE niche_id = (pick->>'niche_id')::uuid AND hook_id = pick->>'hook_id';
    UPDATE hook_examples SET internal_uses_7d = COALESCE(internal_uses_7d, 0) + 1
      WHERE id = pick->>'hook_id' AND niche_id = (pick->>'niche_id')::uuid;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION decrement_hook_uses()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE hook_examples
  SET internal_uses_7d = GREATEST(0, FLOOR(COALESCE(internal_uses_7d, 0) / 2.0))
  WHERE COALESCE(internal_uses_7d, 0) > 0;
$$;
