import { getServiceClient } from '@/lib/insforge/server';
import { getSocialProviderMode } from '@/lib/env';

// --- Types ---

export interface AdminOverview {
  users: number;
  onboarded: number;
  subscriptions: Record<string, number>;
  postsToday: number;
  publishQueue: { queued: number; processing: number; failed: number; dead: number };
  aiUsageToday: number;
  signalsEnabled: boolean;
  activeTrials: number;
  trialsExpiringSoon: number;
  leadsCount: number | null;
  timestamp: string;
}

export interface AdminUserFilters {
  q?: string;
  plan?: string;
  status?: string;
  onboarding?: 'complete' | 'incomplete';
  limit?: number;
  offset?: number;
}

export interface AdminUserRow {
  userId: string;
  displayName: string;
  onboardingComplete: boolean;
  plan: string;
  status: string;
  trialEndsAt: string | null;
  createdAt: string;
  postCount: number;
}

export interface AdminPublishJob {
  id: string;
  userId: string;
  postId: string;
  platform: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminFeatureFlag {
  name: string;
  enabled: boolean;
  description: string | null;
  updatedAt: string | null;
}

export interface AdminUsageRow {
  userId: string;
  metric: string;
  periodKey: string;
  count: number;
}

export interface AdminSystemHealth {
  status: string;
  checks: Record<string, 'ok' | 'missing' | 'degraded'>;
  provider: string;
  adminEmailsConfigured: boolean;
  timestamp: string;
}

// --- Queries ---

/**
 * Aggregates platform KPIs for the admin overview page.
 * Uses service role to read cross-tenant data.
 */
export async function getAdminOverview(): Promise<AdminOverview> {
  const client = getServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const dayStart = `${today}T00:00:00.000Z`;

  const [
    profilesRes,
    onboardedRes,
    subsRes,
    postsRes,
    queueRes,
    aiRes,
    flagRes,
    trialRes,
    leadsRes,
  ] = await Promise.all([
    client.database.from('creator_profile').select('id', { count: 'exact', head: true }),
    client.database
      .from('creator_profile')
      .select('id', { count: 'exact', head: true })
      .eq('onboarding_complete', true),
    client.database.from('subscriptions').select('plan, status, trial_ends_at'),
    client.database
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', dayStart),
    client.database.from('publish_jobs').select('status'),
    client.database
      .from('usage_counters')
      .select('count')
      .eq('metric', 'ai_generate')
      .eq('period_key', today.slice(0, 7)),
    client.database.from('feature_flags').select('enabled').eq('name', 'signals_engine').maybeSingle(),
    client.database.from('subscriptions').select('trial_ends_at').eq('status', 'trialing'),
    client.database.from('signal_leads').select('id', { count: 'exact', head: true }),
  ]);

  const subscriptions: Record<string, number> = {};
  for (const row of subsRes.data ?? []) {
    const key = `${row.plan as string}:${row.status as string}`;
    subscriptions[key] = (subscriptions[key] ?? 0) + 1;
  }

  const queue = { queued: 0, processing: 0, failed: 0, dead: 0 };
  for (const row of queueRes.data ?? []) {
    const s = row.status as keyof typeof queue;
    if (s in queue) queue[s]++;
  }

  const aiUsageToday = (aiRes.data ?? []).reduce((sum, r) => sum + (r.count as number), 0);

  const weekAhead = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const trialRows = trialRes.data ?? [];
  const activeTrials = trialRows.length;
  const trialsExpiringSoon = trialRows.filter((row) => {
    const ends = row.trial_ends_at as string | null;
    return ends != null && ends <= weekAhead;
  }).length;

  const leadsCount = leadsRes.error ? null : (leadsRes.count ?? 0);

  return {
    users: profilesRes.count ?? 0,
    onboarded: onboardedRes.count ?? 0,
    subscriptions,
    postsToday: postsRes.count ?? 0,
    publishQueue: queue,
    aiUsageToday,
    signalsEnabled: flagRes.data?.enabled ?? true,
    activeTrials,
    trialsExpiringSoon,
    leadsCount,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Lists users with profile, subscription, and post counts for admin management.
 * Supports search by display name and filters on plan, status, and onboarding.
 */
export async function getAdminUsers(filters: AdminUserFilters = {}): Promise<AdminUserRow[]> {
  const client = getServiceClient();
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;

  let userIdFilter: string[] | null = null;

  if (filters.plan || filters.status) {
    let subQuery = client.database.from('subscriptions').select('user_id');
    if (filters.plan) subQuery = subQuery.eq('plan', filters.plan);
    if (filters.status) subQuery = subQuery.eq('status', filters.status);
    const { data: subRows } = await subQuery.limit(500);
    userIdFilter = (subRows ?? []).map((r) => r.user_id as string);
    if (userIdFilter.length === 0) return [];
  }

  let profileQuery = client.database
    .from('creator_profile')
    .select('user_id, display_name, onboarding_complete, created_at')
    .order('created_at', { ascending: false });

  if (filters.q?.trim()) {
    profileQuery = profileQuery.ilike('display_name', `%${filters.q.trim()}%`);
  }
  if (filters.onboarding === 'complete') {
    profileQuery = profileQuery.eq('onboarding_complete', true);
  } else if (filters.onboarding === 'incomplete') {
    profileQuery = profileQuery.eq('onboarding_complete', false);
  }
  if (userIdFilter) {
    profileQuery = profileQuery.in('user_id', userIdFilter);
  }

  const { data: profiles, error } = await profileQuery.range(offset, offset + limit - 1);

  if (error || !profiles?.length) return [];

  const userIds = profiles.map((p) => p.user_id as string);

  const [subsRes, postsRes] = await Promise.all([
    client.database.from('subscriptions').select('user_id, plan, status, trial_ends_at').in('user_id', userIds),
    client.database.from('posts').select('user_id').in('user_id', userIds),
  ]);

  const subsByUser = new Map(
    (subsRes.data ?? []).map((s) => [s.user_id as string, s]),
  );
  const postCounts = new Map<string, number>();
  for (const p of postsRes.data ?? []) {
    const uid = p.user_id as string;
    postCounts.set(uid, (postCounts.get(uid) ?? 0) + 1);
  }

  return profiles.map((p) => {
    const sub = subsByUser.get(p.user_id as string);
    return {
      userId: p.user_id as string,
      displayName: p.display_name as string,
      onboardingComplete: p.onboarding_complete as boolean,
      plan: (sub?.plan as string) ?? 'free',
      status: (sub?.status as string) ?? 'inactive',
      trialEndsAt: (sub?.trial_ends_at as string | null) ?? null,
      createdAt: p.created_at as string,
      postCount: postCounts.get(p.user_id as string) ?? 0,
    };
  });
}

/**
 * Returns subscription rows for billing overview.
 */
export async function getAdminSubscriptions(): Promise<
  Array<{
    userId: string;
    plan: string;
    status: string;
    trialEndsAt: string | null;
    stripeCustomerId: string | null;
    currentPeriodEnd: string | null;
    updatedAt: string;
  }>
> {
  const client = getServiceClient();
  const { data } = await client.database
    .from('subscriptions')
    .select('user_id, plan, status, trial_ends_at, stripe_customer_id, current_period_end, updated_at')
    .order('updated_at', { ascending: false })
    .limit(200);

  return (data ?? []).map((s) => ({
    userId: s.user_id as string,
    plan: s.plan as string,
    status: s.status as string,
    trialEndsAt: (s.trial_ends_at as string | null) ?? null,
    stripeCustomerId: (s.stripe_customer_id as string | null) ?? null,
    currentPeriodEnd: (s.current_period_end as string | null) ?? null,
    updatedAt: s.updated_at as string,
  }));
}

/**
 * Lists publish jobs filtered by status for ops monitoring.
 */
export async function getAdminPublishJobs(
  statusFilter?: string[],
  limit = 100,
): Promise<AdminPublishJob[]> {
  const client = getServiceClient();
  let query = client.database
    .from('publish_jobs')
    .select('id, user_id, post_id, platform, status, attempts, max_attempts, last_error, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (statusFilter?.length) {
    query = query.in('status', statusFilter);
  }

  const { data } = await query;
  return (data ?? []).map((j) => ({
    id: j.id as string,
    userId: j.user_id as string,
    postId: j.post_id as string,
    platform: j.platform as string,
    status: j.status as string,
    attempts: j.attempts as number,
    maxAttempts: j.max_attempts as number,
    lastError: (j.last_error as string | null) ?? null,
    createdAt: j.created_at as string,
    updatedAt: j.updated_at as string,
  }));
}

/**
 * Lists all feature flags for kill-switch management.
 */
export async function getAdminFeatureFlags(): Promise<AdminFeatureFlag[]> {
  const client = getServiceClient();
  const { data } = await client.database
    .from('feature_flags')
    .select('name, enabled, description, updated_at')
    .order('name');

  return (data ?? []).map((f) => ({
    name: f.name as string,
    enabled: f.enabled as boolean,
    description: (f.description as string | null) ?? null,
    updatedAt: (f.updated_at as string | null) ?? null,
  }));
}

/**
 * Returns current-period usage counters across all users.
 */
export async function getAdminUsage(limit = 200): Promise<AdminUsageRow[]> {
  const client = getServiceClient();
  const periodKey = new Date().toISOString().slice(0, 7);

  const { data } = await client.database
    .from('usage_counters')
    .select('user_id, metric, period_key, count')
    .eq('period_key', periodKey)
    .order('count', { ascending: false })
    .limit(limit);

  return (data ?? []).map((u) => ({
    userId: u.user_id as string,
    metric: u.metric as string,
    periodKey: u.period_key as string,
    count: u.count as number,
  }));
}

/**
 * Builds extended system health for the admin system page.
 */
export function getAdminSystemHealth(): AdminSystemHealth {
  const checks: Record<string, 'ok' | 'missing' | 'degraded'> = {
    insforge:
      process.env.NEXT_PUBLIC_INSFORGE_URL && process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ? 'ok' : 'missing',
    serviceRole: process.env.INSFORGE_SERVICE_ROLE_KEY ? 'ok' : 'missing',
    encryption:
      process.env.NODE_ENV === 'production'
        ? process.env.TOKEN_ENCRYPTION_KEY?.length === 64
          ? 'ok'
          : 'missing'
        : 'ok',
    cron: process.env.CRON_SECRET ? 'ok' : 'missing',
    stripe: process.env.STRIPE_SECRET_KEY ? 'ok' : 'degraded',
    llm: process.env.LLM_API_KEY ? 'ok' : 'degraded',
    social:
      getSocialProviderMode() === 'unipile'
        ? process.env.UNIPILE_API_KEY && process.env.UNIPILE_DSN
          ? 'ok'
          : 'missing'
        : 'ok',
  };

  const requiredMissing = ['insforge', 'serviceRole'].some((k) => checks[k] === 'missing');

  return {
    status: requiredMissing ? 'degraded' : 'ok',
    checks,
    provider: getSocialProviderMode(),
    adminEmailsConfigured: (process.env.ADMIN_EMAILS ?? '').trim().length > 0,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Admin retry for a failed/dead publish job (service role, no user scope).
 */
export async function adminRetryPublishJob(jobId: string): Promise<boolean> {
  const client = getServiceClient();
  const { error } = await client.database
    .from('publish_jobs')
    .update({
      status: 'queued',
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .in('status', ['failed', 'dead']);

  return !error;
}

/**
 * Toggles a feature flag by name.
 */
export async function adminSetFeatureFlag(name: string, enabled: boolean): Promise<boolean> {
  const client = getServiceClient();
  const { error } = await client.database
    .from('feature_flags')
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq('name', name);

  return !error;
}

/**
 * Updates a user's subscription plan/status (manual override for support).
 */
export async function adminUpdateSubscription(
  userId: string,
  updates: { plan?: string; status?: string },
): Promise<boolean> {
  const client = getServiceClient();
  const { error } = await client.database
    .from('subscriptions')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  return !error;
}

/**
 * Forces onboarding complete/incomplete for a user (support flow).
 */
export async function adminSetOnboarding(userId: string, complete: boolean): Promise<boolean> {
  const client = getServiceClient();
  const { error } = await client.database
    .from('creator_profile')
    .update({ onboarding_complete: complete, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  return !error;
}
