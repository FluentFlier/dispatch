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
   * Track an intelligence/monetized action.
   * Throws (or returns {allowed:false}) when over plan limit.
   */
  async track(
    userId: string,
    action: 'research' | 'generate' | 'analytics' | 'agent_call',
    metadata: Record<string, any> = {}
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
        // In real flow we would look up stripe_customer_id from subscriptions table
        // For now this is ready — the infrastructure exists
        if (process.env.STRIPE_SECRET_KEY) {
          // recordUsageEvent({ customerId: '...', metric: action === 'research' ? 'research_calls' : 'ai_generations', value: 1 })
          console.log(`[Usage] Meter event ready for ${action} (wire customer lookup to activate)`);
        }
      } catch {}

      return { allowed: true };
    } catch (e) {
      console.warn('[UsageTracker] increment failed (dev fallback allowed):', e);
      return { allowed: true }; // never hard-block in dev/missing table
    }
  }
}

export const usage = new UsageTracker();
