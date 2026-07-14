import { getServiceClient } from '@/lib/insforge/server';
import { getOrCreateSubscription } from '@/lib/entitlements';
import { computeTrialEndDate, isAppTrialActive } from '@/lib/trial';
import { trackEvent } from '@/lib/analytics';
import type { PlanId } from '@/lib/entitlements';

/** Plans a trial code may grant (excludes 'free' — a code always unlocks access). */
export const TRIAL_CODE_PLANS: Exclude<PlanId, 'free'>[] = ['starter', 'growth', 'pro', 'unlimited'];

export interface TrialCode {
  code: string;
  plan: string;
  trialDays: number;
  active: boolean;
  maxRedemptions: number | null;
  redemptionCount: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TrialCodeRow {
  code: string;
  plan: string;
  trial_days: number;
  active: boolean;
  max_redemptions: number | null;
  redemption_count: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: TrialCodeRow): TrialCode {
  return {
    code: row.code,
    plan: row.plan,
    trialDays: row.trial_days,
    active: row.active,
    maxRedemptions: row.max_redemptions,
    redemptionCount: row.redemption_count,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Normalize user input to the stored code form: trimmed, uppercased. */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase();
}

export type RedeemResult =
  | { ok: true; status: 'started'; plan: string; trialEndsAt: string }
  | { ok: true; status: 'already_active' }
  | { ok: true; status: 'already_paid' }
  | { ok: false; error: string };

/**
 * Redeems a trial code for a user: validates the code, starts a trial with the
 * code's plan + duration, and records the redemption.
 *
 * Uses the service client because trial_codes is admin-owned (RLS blocks anon).
 * A user who already has a trial or paid plan is short-circuited without
 * consuming a redemption.
 */
export async function redeemTrialCode(userId: string, rawCode: string): Promise<RedeemResult> {
  const code = normalizeCode(rawCode);
  if (!code) {
    return { ok: false, error: 'Enter a code.' };
  }

  const service = getServiceClient();

  // Don't let an already-provisioned user burn a redemption.
  const sub = await getOrCreateSubscription(userId);
  if (isAppTrialActive(sub)) {
    return { ok: true, status: 'already_active' };
  }
  if (sub.stripe_subscription_id || sub.status === 'active') {
    return { ok: true, status: 'already_paid' };
  }
  if (sub.trial_ends_at) {
    return { ok: false, error: 'Your free trial has already been used. Choose a plan to continue.' };
  }

  const { data: rows } = await service.database
    .from('trial_codes')
    .select('code, plan, trial_days, active, max_redemptions, redemption_count, note, created_at, updated_at')
    .eq('code', code)
    .limit(1);

  const row = rows?.[0] as TrialCodeRow | undefined;
  if (!row) {
    return { ok: false, error: 'That code is not valid.' };
  }
  if (!row.active) {
    return { ok: false, error: 'That code is no longer active.' };
  }
  if (row.max_redemptions != null && row.redemption_count >= row.max_redemptions) {
    return { ok: false, error: 'That code has reached its redemption limit.' };
  }

  // Record the redemption first. The unique(user_id) constraint makes this the
  // atomic guard against a single user redeeming twice (double-submit / retry).
  const { error: redeemErr } = await service.database
    .from('trial_code_redemptions')
    .insert([{ code, user_id: userId }]);
  if (redeemErr) {
    return { ok: false, error: 'You have already redeemed a code.' };
  }

  const trialEndsAt = computeTrialEndDate(new Date(), row.trial_days);

  const { error: subErr } = await service.database.from('subscriptions').upsert(
    [
      {
        user_id: userId,
        plan: row.plan,
        status: 'trialing',
        trial_ends_at: trialEndsAt,
        updated_at: new Date().toISOString(),
      },
    ],
    { onConflict: 'user_id' },
  );
  if (subErr) {
    // Roll back the redemption so the user can retry cleanly.
    await service.database.from('trial_code_redemptions').delete().eq('user_id', userId).eq('code', code);
    return { ok: false, error: 'Could not start your trial. Please try again.' };
  }

  await service.database
    .from('trial_codes')
    .update({ redemption_count: row.redemption_count + 1, updated_at: new Date().toISOString() })
    .eq('code', code);

  await trackEvent('trial_code_redeemed', { userId, code, plan: row.plan, trialDays: row.trial_days });

  return { ok: true, status: 'started', plan: row.plan, trialEndsAt };
}
