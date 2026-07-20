/**
 * Lightweight product analytics (server-side events).
 * Extend with PostHog/Plausible by setting ANALYTICS_WEBHOOK_URL.
 */

import { logInfo } from '@/lib/logger';

export type AnalyticsEvent =
  | 'signup_complete'
  | 'onboarding_complete'
  | 'account_connected'
  | 'first_post_scheduled'
  | 'first_publish_success'
  | 'upgrade_checkout_started'
  | 'subscription_active'
  | 'trial_started'
  | 'trial_code_redeemed'
  | 'publish_failed'
  | 'generation_complete'
  | 'edit_feedback_submitted'
  | 'rl_hooks_updated'
  | 'voice_drift_detected'
  | 'canary_alarm'
  | 'onboarding_step_viewed'
  | 'onboarding_step_skipped'
  | 'onboarding_ingest_started'
  | 'onboarding_ingest_failed'
  | 'onboarding_ingest_timeout'
  | 'onboarding_pillars_derived_fallback';

export async function trackEvent(
  event: AnalyticsEvent,
  properties: Record<string, string | number | boolean> = {}
): Promise<void> {
  const payload = {
    event,
    properties,
    ts: new Date().toISOString(),
  };

  logInfo('analytics', payload);

  const webhook = process.env.ANALYTICS_WEBHOOK_URL;
  if (!webhook) return;

  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // non-blocking
  }
}
