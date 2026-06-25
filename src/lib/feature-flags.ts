import type { createClient } from '@insforge/sdk';

type InsforgeClient = ReturnType<typeof createClient>;

/**
 * Checks the feature_flags table before a cron or layer runs.
 * Returns true if the flag is enabled (or missing — defaults open).
 * Flip enabled=false in the InsForge dashboard to kill a layer without redeploy.
 */
export async function isEnabled(
  client: InsforgeClient,
  flagName: string,
): Promise<boolean> {
  const { data } = await client.database
    .from('feature_flags')
    .select('enabled')
    .eq('name', flagName)
    .single();
  return data?.enabled ?? true;
}
