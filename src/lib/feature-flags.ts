import type { createClient } from '@insforge/sdk';

type InsforgeClient = ReturnType<typeof createClient>;

/**
 * Checks the feature_flags table before a cron or layer runs.
 *
 * - Table missing / query error → false (fail closed). Prevents crons from
 *   thrashing an unprovisioned DB and looking "healthy".
 * - Row missing → true (default open). Unseeded flags stay on so we don't
 *   silently disable calendar/event layers that were never inserted.
 * - Row present → respect enabled boolean.
 *
 * Flip enabled=false in the InsForge dashboard to kill a layer without redeploy.
 * Apply db/intelligence-backend.sql (and production-delta seeds) in production.
 */
export async function isEnabled(
  client: InsforgeClient,
  flagName: string,
): Promise<boolean> {
  const { data, error } = await client.database
    .from('feature_flags')
    .select('enabled')
    .eq('name', flagName)
    .maybeSingle();

  if (error) return false;
  if (!data) return true;
  return data.enabled === true;
}
