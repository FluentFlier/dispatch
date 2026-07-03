import { getServerClient } from '@/lib/insforge/server';
import { getUsageCount } from '@/lib/usage';
import { isAppTrialActive } from '@/lib/trial';

export type PlanId = 'free' | 'starter' | 'growth' | 'pro';

export interface PlanLimits {
  connectedAccounts: number;
  publishesPerMonth: number;
  scheduledPerMonth: number;
  aiGenerationsPerMonth: number;
  canPublish: boolean;
  canSchedule: boolean;
}

const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: {
    connectedAccounts: 1,
    publishesPerMonth: 5,
    scheduledPerMonth: 5,
    aiGenerationsPerMonth: 30,
    canPublish: false,
    canSchedule: false,
  },
  starter: {
    connectedAccounts: 3,
    publishesPerMonth: 60,
    scheduledPerMonth: 60,
    aiGenerationsPerMonth: 200,
    canPublish: true,
    canSchedule: true,
  },
  growth: {
    connectedAccounts: 10,
    publishesPerMonth: 300,
    scheduledPerMonth: 300,
    aiGenerationsPerMonth: 1000,
    canPublish: true,
    canSchedule: true,
  },
  pro: {
    connectedAccounts: 30,
    publishesPerMonth: 1500,
    scheduledPerMonth: 1500,
    aiGenerationsPerMonth: 5000,
    canPublish: true,
    canSchedule: true,
  },
};

export interface UserEntitlements {
  plan: PlanId;
  status: string;
  limits: PlanLimits;
  usage: {
    publishes: number;
    scheduled: number;
    aiGenerations: number;
  };
  isPaid: boolean;
}

export async function getOrCreateSubscription(userId: string): Promise<{
  plan: PlanId;
  status: string;
  trial_ends_at?: string | null;
  stripe_subscription_id?: string | null;
}> {
  const client = getServerClient();

  const { data: rows } = await client.database
    .from('subscriptions')
    .select('plan, status, trial_ends_at, stripe_subscription_id')
    .eq('user_id', userId)
    .limit(1);

  const existing = rows?.[0] as
    | { plan: PlanId; status: string; trial_ends_at?: string | null; stripe_subscription_id?: string | null }
    | undefined;
  if (existing) {
    return existing;
  }

  await client.database.from('subscriptions').insert([
    {
      user_id: userId,
      plan: 'free',
      status: 'inactive',
    },
  ]);

  return { plan: 'free', status: 'inactive', trial_ends_at: null, stripe_subscription_id: null };
}

export async function getUserEntitlements(userId: string): Promise<UserEntitlements> {
  const sub = await getOrCreateSubscription(userId);
  const appTrial = isAppTrialActive(sub);
  const plan = (
    appTrial ? 'starter' : sub.plan in PLAN_LIMITS ? sub.plan : 'free'
  ) as PlanId;
  const limits = PLAN_LIMITS[plan];

  const [publishes, scheduled, aiGenerations] = await Promise.all([
    getUsageCount(userId, 'publish_post'),
    getUsageCount(userId, 'scheduled_post'),
    getUsageCount(userId, 'ai_generate'),
  ]);

  const isPaid =
    sub.status === 'active' ||
    appTrial ||
    (sub.status === 'trialing' && Boolean(sub.stripe_subscription_id));

  return {
    plan,
    status: appTrial ? 'trialing' : sub.status,
    limits,
    usage: { publishes, scheduled, aiGenerations },
    isPaid: isPaid && limits.canPublish,
  };
}

export async function assertCanPublish(userId: string): Promise<{
  ok: boolean;
  error?: string;
  entitlements: UserEntitlements;
}> {
  const entitlements = await getUserEntitlements(userId);

  if (!entitlements.limits.canPublish) {
    return {
      ok: false,
      error: 'Publishing requires a paid plan. Upgrade to Starter or above.',
      entitlements,
    };
  }

  if (entitlements.usage.publishes >= entitlements.limits.publishesPerMonth) {
    return {
      ok: false,
      error: `Monthly publish limit reached (${entitlements.limits.publishesPerMonth}).`,
      entitlements,
    };
  }

  return { ok: true, entitlements };
}

export async function assertCanSchedule(userId: string): Promise<{
  ok: boolean;
  error?: string;
  entitlements: UserEntitlements;
}> {
  const entitlements = await getUserEntitlements(userId);

  if (!entitlements.limits.canSchedule) {
    return {
      ok: false,
      error: 'Scheduling requires a paid plan. Upgrade to Starter or above.',
      entitlements,
    };
  }

  if (entitlements.usage.scheduled >= entitlements.limits.scheduledPerMonth) {
    return {
      ok: false,
      error: `Monthly schedule limit reached (${entitlements.limits.scheduledPerMonth}).`,
      entitlements,
    };
  }

  return { ok: true, entitlements };
}

export async function assertCanGenerate(userId: string): Promise<{
  ok: boolean;
  error?: string;
  entitlements: UserEntitlements;
}> {
  const entitlements = await getUserEntitlements(userId);

  if (entitlements.usage.aiGenerations >= entitlements.limits.aiGenerationsPerMonth) {
    return {
      ok: false,
      error: `Monthly AI generation limit reached (${entitlements.limits.aiGenerationsPerMonth}). Upgrade your plan for more.`,
      entitlements,
    };
  }

  return { ok: true, entitlements };
}

export function getPlanPriceIds(): Record<Exclude<PlanId, 'free'>, string | undefined> {
  return {
    starter: process.env.STRIPE_PRICE_STARTER,
    growth: process.env.STRIPE_PRICE_GROWTH,
    pro: process.env.STRIPE_PRICE_PRO,
  };
}
