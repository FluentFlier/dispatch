-- Follow-up to 20260711120000_niches-and-hook-arms.sql (that migration is
-- already committed, so this adds the usage-bump RPC in its own file rather
-- than editing it). Same RLS-free function pattern.

-- Atomic per-request usage bump (pulls + burn-out counter).
CREATE OR REPLACE FUNCTION increment_hook_usage(p_picks JSONB)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE pick JSONB;
BEGIN
  FOR pick IN SELECT * FROM jsonb_array_elements(p_picks) LOOP
    UPDATE hook_arms SET pulls = pulls + 1, updated_at = now()
      WHERE niche_id = (pick->>'niche_id')::uuid AND hook_id = pick->>'hook_id';
    UPDATE hook_examples SET internal_uses_7d = COALESCE(internal_uses_7d, 0) + 1
      WHERE id = pick->>'hook_id' AND niche_id = (pick->>'niche_id')::uuid;
  END LOOP;
END $$;

-- Weekly burn-out decay: halves internal_uses_7d so hooks aren't permanently
-- suppressed after a single busy week (spec 2.3 burn-out cap decay).
CREATE OR REPLACE FUNCTION decrement_hook_uses()
RETURNS void LANGUAGE sql AS $$
  UPDATE hook_examples
  SET internal_uses_7d = GREATEST(0, FLOOR(COALESCE(internal_uses_7d, 0) / 2.0))
  WHERE COALESCE(internal_uses_7d, 0) > 0;
$$;
