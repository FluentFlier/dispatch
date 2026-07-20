import type { createClient } from '@insforge/sdk';
import type { OutreachChannel } from '@/lib/signals/types';
import {
  channelToLimitKey,
  computeRequiredCooldownMs,
  isWithinWorkingHours,
  LINKEDIN_ACTION_CAPS,
  type SignalSafetySettings,
} from '@/lib/signals/safety/limits';
import {
  countAuditActions,
  getLastSendTimestamp,
  logSignalAudit,
} from '@/lib/signals/safety/audit';
import { getSafetySettings } from '@/lib/signals/safety/settings';

type InsforgeClient = ReturnType<typeof createClient>;

export interface OutreachGuardResult {
  allowed: boolean;
  reason?: string;
  retryAfterSeconds?: number;
  settings: SignalSafetySettings;
}

function startOfUtcDay(iso: string = new Date().toISOString()): string {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

function startOfUtcWeek(iso: string = new Date().toISOString()): string {
  const d = new Date(iso);
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

/**
 * Gate every outbound outreach action. Defaults block sends until explicitly enabled.
 */
export async function assertOutreachAllowed(
  client: InsforgeClient,
  workspaceId: string,
  channel: OutreachChannel,
  opts: { eventId?: string; leadId?: string; socialAccountId?: string; now?: Date } = {},
): Promise<OutreachGuardResult> {
  const settings = await getSafetySettings(client, workspaceId);
  const now = opts.now ?? new Date();

  const block = async (reason: string, retryAfterSeconds?: number): Promise<OutreachGuardResult> => {
    await logSignalAudit(client, {
      workspace_id: workspaceId,
      action: 'outreach_blocked',
      channel,
      event_id: opts.eventId,
      lead_id: opts.leadId,
      social_account_id: opts.socialAccountId,
      blocked_reason: reason,
    });
    return { allowed: false, reason, retryAfterSeconds, settings };
  };

  if (channel === 'copy') {
    return { allowed: true, settings };
  }

  if (!settings.outreach_enabled) {
    return block('Outreach is disabled for this workspace. Enable it in Signals safety settings after review.');
  }

  if (settings.dry_run) {
    return block('Dry-run mode is on. Drafts only - no messages will be sent until dry_run is disabled.');
  }

  if (!isWithinWorkingHours(settings, now)) {
    return block(
      `Outside working hours (UTC ${settings.working_hours_utc_start}:00-${settings.working_hours_utc_end}:00). Sends are paused to reduce ban risk.`,
    );
  }

  const lastSend = await getLastSendTimestamp(client, workspaceId);
  if (lastSend) {
    const elapsed = now.getTime() - new Date(lastSend).getTime();
    const requiredMs = computeRequiredCooldownMs(settings);
    if (elapsed < requiredMs) {
      const retryAfterSeconds = Math.ceil((requiredMs - elapsed) / 1000);
      return block(
        `Cooldown active. Wait ${retryAfterSeconds}s between sends (human-like spacing).`,
        retryAfterSeconds,
      );
    }
  }

  const limitKey = channelToLimitKey(channel);
  if (!limitKey) return { allowed: true, settings };

  const dayStart = startOfUtcDay(now.toISOString());

  if (limitKey === 'linkedin_invite') {
    const weekStart = startOfUtcWeek(now.toISOString());
    const [daily, weekly] = await Promise.all([
      countAuditActions(
        client,
        workspaceId,
        'outreach_send_success',
        dayStart,
        'linkedin_connect',
      ),
      countAuditActions(
        client,
        workspaceId,
        'outreach_send_success',
        weekStart,
        'linkedin_connect',
      ),
    ]);
    if (daily >= settings.max_linkedin_invites_per_day) {
      return block(
        `Daily LinkedIn invite cap reached (${settings.max_linkedin_invites_per_day}/${settings.max_linkedin_invites_per_day}). Resets UTC midnight.`,
      );
    }

    if (weekly >= settings.max_linkedin_invites_per_week) {
      return block(
        `Weekly LinkedIn invite cap reached (${settings.max_linkedin_invites_per_week}). LinkedIn limits ~200/week - we stop earlier.`,
      );
    }
  }

  if (limitKey === 'linkedin_inmail') {
    const daily = await countAuditActions(
      client,
      workspaceId,
      'outreach_send_success',
      dayStart,
      'linkedin_dm',
    );
    if (daily >= settings.max_linkedin_inmail_per_day) {
      return block(
        `Daily InMail cap reached (${settings.max_linkedin_inmail_per_day}). Protects InMail credits and account standing.`,
      );
    }
  }

  if (limitKey === 'x_dm') {
    const daily = await countAuditActions(
      client,
      workspaceId,
      'outreach_send_success',
      dayStart,
      'x_dm',
    );
    if (daily >= settings.max_x_dm_per_day) {
      return block(`Daily X DM cap reached (${settings.max_x_dm_per_day}).`);
    }
  }

  if (limitKey === 'gmail') {
    const daily = await countAuditActions(
      client,
      workspaceId,
      'outreach_send_success',
      dayStart,
      'gmail',
    );
    if (daily >= settings.max_gmail_per_day) {
      return block(`Daily Gmail cap reached (${settings.max_gmail_per_day}). Protects sender reputation.`);
    }
  }

  if (limitKey === 'linkedin_follow') {
    const daily = await countAuditActions(
      client,
      workspaceId,
      'outreach_send_success',
      dayStart,
      'linkedin_follow',
    );
    if (daily >= LINKEDIN_ACTION_CAPS.followsPerDay) {
      return block(
        `Daily LinkedIn follow cap reached (${LINKEDIN_ACTION_CAPS.followsPerDay}). Unipile recommends spacing follows across the day - resets UTC midnight.`,
      );
    }
  }

  if (limitKey === 'linkedin_comment') {
    const daily = await countAuditActions(
      client,
      workspaceId,
      'outreach_send_success',
      dayStart,
      'linkedin_comment',
    );
    if (daily >= LINKEDIN_ACTION_CAPS.commentsPerDay) {
      return block(
        `Daily LinkedIn comment cap reached (${LINKEDIN_ACTION_CAPS.commentsPerDay}). Comments are spaced randomly to protect your account.`,
      );
    }
  }

  return { allowed: true, settings };
}

/**
 * Profile lookups count toward LinkedIn's ~100/day recommendation. Gate before
 * resolveLinkedInProfile so rapid lead browsing cannot burn the account quota.
 */
export async function assertLinkedInProfileLookupAllowed(
  client: InsforgeClient,
  workspaceId: string,
  opts: { leadId?: string; now?: Date } = {},
): Promise<OutreachGuardResult> {
  const settings = await getSafetySettings(client, workspaceId);
  const now = opts.now ?? new Date();
  const dayStart = startOfUtcDay(now.toISOString());

  const block = async (reason: string): Promise<OutreachGuardResult> => {
    await logSignalAudit(client, {
      workspace_id: workspaceId,
      action: 'outreach_blocked',
      channel: 'linkedin_connect',
      lead_id: opts.leadId,
      blocked_reason: reason,
    });
    return { allowed: false, reason, settings };
  };

  if (!settings.outreach_enabled) {
    return block('Outreach is disabled for this workspace.');
  }

  const daily = await countAuditActions(client, workspaceId, 'profile_lookup', dayStart);
  if (daily >= LINKEDIN_ACTION_CAPS.profileLookupsPerDay) {
    return block(
      `Daily LinkedIn profile lookup cap reached (${LINKEDIN_ACTION_CAPS.profileLookupsPerDay}). Try again tomorrow to avoid account restrictions.`,
    );
  }

  return { allowed: true, settings };
}

/** Returns whether auto_send rules may fire (stricter than manual send). */
export async function assertAutoSendAllowed(
  client: InsforgeClient,
  workspaceId: string,
  channel: OutreachChannel,
): Promise<OutreachGuardResult> {
  const manual = await assertOutreachAllowed(client, workspaceId, channel);
  if (!manual.allowed) return manual;

  if (!manual.settings.auto_send_enabled) {
    await logSignalAudit(client, {
      workspace_id: workspaceId,
      action: 'outreach_blocked',
      channel,
      blocked_reason: 'Auto-send is disabled. Manual approval required.',
    });
    return {
      allowed: false,
      reason: 'Auto-send is disabled. All outreach requires manual approval.',
      settings: manual.settings,
    };
  }

  return manual;
}

export interface SafetyStatusSnapshot {
  settings: SignalSafetySettings;
  usage: {
    linkedin_invites_today: number;
    linkedin_invites_this_week: number;
    linkedin_inmail_today: number;
    x_dm_today: number;
  };
  within_working_hours: boolean;
  last_send_at: string | null;
}

export async function getSafetyStatus(
  client: InsforgeClient,
  workspaceId: string,
): Promise<SafetyStatusSnapshot> {
  const settings = await getSafetySettings(client, workspaceId);
  const now = new Date();
  const dayStart = startOfUtcDay(now.toISOString());
  const weekStart = startOfUtcWeek(now.toISOString());

  const [
    linkedin_invites_today,
    linkedin_invites_this_week,
    linkedin_inmail_today,
    x_dm_today,
    last_send_at,
  ] = await Promise.all([
    countAuditActions(client, workspaceId, 'outreach_send_success', dayStart, 'linkedin_connect'),
    countAuditActions(client, workspaceId, 'outreach_send_success', weekStart, 'linkedin_connect'),
    countAuditActions(client, workspaceId, 'outreach_send_success', dayStart, 'linkedin_dm'),
    countAuditActions(client, workspaceId, 'outreach_send_success', dayStart, 'x_dm'),
    getLastSendTimestamp(client, workspaceId),
  ]);

  return {
    settings,
    usage: {
      linkedin_invites_today,
      linkedin_invites_this_week,
      linkedin_inmail_today,
      x_dm_today,
    },
    within_working_hours: isWithinWorkingHours(settings, now),
    last_send_at,
  };
}

export function shouldPollSource(
  lastPolledAt: string | null,
  pollIntervalMinutes: number,
  minPollIntervalMinutes: number,
  now: Date = new Date(),
): boolean {
  const intervalMin = Math.max(pollIntervalMinutes, minPollIntervalMinutes);
  if (!lastPolledAt) return true;
  const elapsed = now.getTime() - new Date(lastPolledAt).getTime();
  return elapsed >= intervalMin * 60_000;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
