import type { createClient } from '@insforge/sdk';
import { syncWorkspaceDirectory } from '@/lib/signals/ingest/sync-directory';
import { reactivateWorkspaceLeads } from '@/lib/signals/leads/reactivate';
import { getDirectorySettings, listLeads, updateDirectorySettings } from '@/lib/signals/leads/store';
import { getIntegration } from '@/lib/signals/integrations/store';
import { isComposioConfigured } from '@/lib/composio/config';
import { sendSlackAlert } from '@/lib/composio/actions/slack';
import { sendGmailEmail } from '@/lib/composio/actions/gmail';
import type { SignalLeadWithContacts } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

// --- Pure scheduling helpers (testable, no DB) ---

/** Local hour (0-23) and YYYY-MM-DD date for an instant in a timezone. */
export function localHourAndDate(now: Date, timezone: string): { hour: number; date: string } {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    let hour = parseInt(get('hour'), 10);
    if (hour === 24) hour = 0; // some engines emit 24 for midnight
    return { hour, date: `${get('year')}-${get('month')}-${get('day')}` };
  } catch {
    // Invalid timezone → fall back to UTC.
    return { hour: now.getUTCHours(), date: now.toISOString().slice(0, 10) };
  }
}

/**
 * Whether the digest should run now: not already delivered today (local date),
 * and the local hour has reached the configured run hour. The `>=` gives free
 * catch-up when a scheduled hour was missed (deploy downtime), while the
 * delivered-today guard keeps it idempotent across the hourly cron.
 */
export function shouldRunDigest(input: {
  localHour: number;
  localDate: string;
  runHour: number;
  deliveredLocalDate: string | null;
}): boolean {
  if (input.deliveredLocalDate === input.localDate) return false;
  return input.localHour >= input.runHour;
}

export interface DigestPayload {
  count: number;
  top: SignalLeadWithContacts[];
}

/** Assembles the digest: count of surfaced leads + the top N by rank. */
export function assembleDigest(leads: SignalLeadWithContacts[], topN: number): DigestPayload {
  const sorted = leads.slice().sort((a, b) => b.rank_score - a.rank_score);
  return { count: sorted.length, top: sorted.slice(0, Math.max(0, topN)) };
}

// --- Orchestration ---

/** Per-channel delivery outcome, so the UI/logs can explain a non-send. */
export interface ChannelOutcome {
  sent: boolean;
  /** sent | channel_off | no_leads | not_connected | no_channel_id | no_recipient | composio_off | send_failed:<msg> */
  reason: string;
}

export interface DigestRunResult {
  ran: boolean;
  reason?: string;
  count?: number;
  channels?: string[];
  results?: { today: ChannelOutcome; slack: ChannelOutcome; email: ChannelOutcome };
}

export interface RunDigestOptions {
  /**
   * Bypass the local-time/idempotency gate and skip the scrape+reactivate
   * pipeline (uses already-ingested leads). Used by the "Send test digest now"
   * button so a user can verify email/Slack delivery on demand without waiting
   * for the hourly cron and without stamping digest_delivered_at (which would
   * suppress the real morning digest).
   */
  force?: boolean;
}

/**
 * One workspace's daily digest: gate on local time + idempotency, run the
 * scrape + reactivation pipeline, assemble today's surfaced leads, and push to
 * enabled channels. Slack/email failures degrade gracefully (logged, non-fatal).
 * `force` (test mode) skips the gate + scrape and does not stamp delivery.
 */
export async function runWorkspaceDigest(
  client: InsforgeClient,
  workspaceId: string,
  now: Date = new Date(),
  opts: RunDigestOptions = {},
): Promise<DigestRunResult> {
  const settings = await getDirectorySettings(client, workspaceId);
  const timezone = settings.digest_timezone || (await getWorkspaceTimezone(client, workspaceId)) || 'UTC';
  const { hour, date } = localHourAndDate(now, timezone);
  const deliveredLocalDate = settings.digest_delivered_at
    ? localHourAndDate(new Date(settings.digest_delivered_at), timezone).date
    : null;

  if (!opts.force && !shouldRunDigest({ localHour: hour, localDate: date, runHour: settings.digest_run_hour_local, deliveredLocalDate })) {
    return { ran: false, reason: `local ${hour}:00 ${date}, run at ${settings.digest_run_hour_local}, delivered ${deliveredLocalDate ?? 'never'}` };
  }

  // Build today's list: scrape + reactivate. Skipped in force/test mode - the
  // regular scrape cron already keeps leads fresh, and a full scrape here would
  // make the test button take minutes.
  if (!opts.force) {
    await syncWorkspaceDirectory(client, workspaceId);
    await reactivateWorkspaceLeads(client, workspaceId, date, now);
  }

  const all = await listLeads(client, workspaceId, { limit: 200 });
  const todays = all.filter(
    (l) => l.digest_date === date && (l.lead_status === 'new' || l.lead_status === 'resurfaced'),
  );
  const digest = assembleDigest(todays, settings.digest_top_n);

  const today: ChannelOutcome = { sent: true, reason: 'sent' };
  const slack = settings.digest_channels?.slack
    ? await pushSlackDigest(client, workspaceId, digest)
    : { sent: false, reason: 'channel_off' };
  const email = settings.digest_channels?.email
    ? await pushEmailDigest(client, workspaceId, digest)
    : { sent: false, reason: 'channel_off' };

  const channels = ['today', ...(slack.sent ? ['slack'] : []), ...(email.sent ? ['email'] : [])];

  // Only stamp delivery on a real (non-forced) run, so the test button never
  // suppresses the morning digest.
  if (!opts.force) {
    await updateDirectorySettings(client, workspaceId, { digest_delivered_at: now.toISOString() });
  }
  return { ran: true, count: digest.count, channels, results: { today, slack, email } };
}

/** Workspace timezone column (browser-detected on first app load). */
async function getWorkspaceTimezone(client: InsforgeClient, workspaceId: string): Promise<string | null> {
  const { data } = await client.database.from('workspaces').select('timezone').eq('id', workspaceId).maybeSingle();
  return (data?.timezone as string) ?? null;
}

function digestSummary(payload: DigestPayload): string {
  return payload.top
    .map((l, i) => `${i + 1}. ${l.company_name}${l.batch ? ` (${l.batch})` : ''} - ${l.tagline ?? ''}`.trim())
    .join('\n');
}

/** Pushes one Slack DM/message with the morning list. Reuses the Signals Slack action. */
async function pushSlackDigest(
  client: InsforgeClient,
  workspaceId: string,
  digest: DigestPayload,
): Promise<ChannelOutcome> {
  if (!isComposioConfigured()) return { sent: false, reason: 'composio_off' };
  if (digest.count === 0) return { sent: false, reason: 'no_leads' };
  const integration = await getIntegration(client, workspaceId, 'slack');
  if (!integration?.enabled) return { sent: false, reason: 'not_connected' };
  const channelId = integration?.config?.slack_channel_id;
  if (!channelId) return { sent: false, reason: 'no_channel_id' };

  const result = await sendSlackAlert(integration.composio_user_id, {
    channelId,
    title: `${digest.count} new lead${digest.count === 1 ? '' : 's'} today`,
    summary: digestSummary(digest),
    company: digest.top[0]?.company_name ?? undefined,
    batch: digest.top[0]?.batch ?? undefined,
    signalUrl: `${appBaseUrl()}/leads`,
  });
  return result.success
    ? { sent: true, reason: 'sent' }
    : { sent: false, reason: `send_failed:${result.error ?? 'unknown'}` };
}

/** Emails the morning list to the workspace owner via Gmail/Composio. */
async function pushEmailDigest(
  client: InsforgeClient,
  workspaceId: string,
  digest: DigestPayload,
): Promise<ChannelOutcome> {
  if (!isComposioConfigured()) return { sent: false, reason: 'composio_off' };
  if (digest.count === 0) return { sent: false, reason: 'no_leads' };
  const integration = await getIntegration(client, workspaceId, 'gmail');
  if (!integration?.enabled) return { sent: false, reason: 'not_connected' };

  const to = await getWorkspaceOwnerEmail(client, workspaceId);
  if (!to) return { sent: false, reason: 'no_recipient' };

  const body = `You have ${digest.count} new leads today.\n\n${digestSummary(digest)}\n\nReview: ${appBaseUrl()}/leads`;
  const result = await sendGmailEmail(integration.composio_user_id, {
    to,
    subject: `${digest.count} new lead${digest.count === 1 ? '' : 's'} today`,
    body,
  });
  return result.success
    ? { sent: true, reason: 'sent' }
    : { sent: false, reason: `send_failed:${result.error ?? 'unknown'}` };
}

/** Resolves the workspace owner's email for the email digest recipient. */
async function getWorkspaceOwnerEmail(client: InsforgeClient, workspaceId: string): Promise<string | null> {
  try {
    const { data: ws } = await client.database.from('workspaces').select('owner_user_id').eq('id', workspaceId).maybeSingle();
    const ownerId = (ws?.owner_user_id as string) ?? null;
    if (!ownerId) return null;
    const { data: user } = await client.database.from('users').select('email').eq('id', ownerId).maybeSingle();
    return (user?.email as string) ?? null;
  } catch {
    return null;
  }
}
