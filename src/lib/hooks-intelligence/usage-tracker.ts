/**
 * Usage Tracking for Monetization (intelligence layer)
 * 
 * Bridges to core usage_counters + entitlements for plan limits.
 * Future: emit Stripe metered usage events for overage billing on research/gen calls.
 * 
 * Actions map to aiGenerationsPerMonth (research + generate both count as intelligence usage).
 */
import { incrementUsage } from '@/lib/usage';
import { getServerClient } from '@/lib/insforge/server';

export class UsageTracker {
  /**
   * Logs an intelligence/monetized action and increments the usage counter.
   *
   * NOTE: This is a logging-only tracker — it does NOT enforce plan limits and
   * always returns `{allowed: true}`. Plan limit enforcement is handled by
   * `guardAiRequest()` in src/lib/ai-guard.ts, which calls `assertCanGenerate()`.
   * Do not rely on the return value of this method for access control.
   */
  async track(
    userId: string,
    action: 'research' | 'generate' | 'analytics' | 'agent_call',
    metadata: Record<string, unknown> = {}
  ): Promise<{ allowed: boolean; remaining?: number }> {
    console.log(`[Usage] ${userId} → ${action}`, metadata);

    try {
      // Map to core metric (ai generation / intelligence usage)
      if (action === 'research' || action === 'generate' || action === 'agent_call') {
        await incrementUsage(userId, 'ai_generate', 1);
      }

      // Optional: also log rich event for future analytics + Stripe meter (best effort, non-blocking)
      const client = getServerClient();
      void client.database.from('usage_events').insert({
        user_id: userId,
        action,
        metadata,
        created_at: new Date().toISOString(),
      });

      // === Stripe metered usage (for overage billing on Pro plans) ===
      try {
        const { recordUsageEvent } = await import('@/lib/stripe');
        if (process.env.STRIPE_SECRET_KEY) {
          // Lookup customer for real metering (best effort)
          const client = getServerClient();
          const { data: sub } = await client.database
            .from('subscriptions')
            .select('stripe_customer_id')
            .eq('user_id', userId)
            .limit(1);
          const customerId = sub?.[0]?.stripe_customer_id as string | undefined;
          if (customerId) {
            const metric = action === 'research' ? 'research_calls' : action === 'generate' ? 'ai_generations' : 'intelligence_usage';
            await recordUsageEvent({ customerId, metric, value: 1 });
            console.log(`[Usage] Metered ${metric} for customer ${customerId}`);
          }
        }
      } catch (e) {
        console.warn('[Usage] Meter emission skipped:', e);
      }

      return { allowed: true };
    } catch (e) {
      console.warn('[UsageTracker] increment failed (dev fallback allowed):', e);
      return { allowed: true }; // never hard-block in dev/missing table
    }
  }
}

export const usage = new UsageTracker();
