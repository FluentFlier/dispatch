import type { createClient } from '@insforge/sdk';
import {
  assertLinkedInProfileLookupAllowed,
  assertOutreachAllowed,
} from '@/lib/signals/safety/guard';
import { awaitInterCallDelay } from '@/lib/signals/safety/humanize';
import { logSignalAudit } from '@/lib/signals/safety/audit';
import { getLead, logLeadEvent } from '@/lib/signals/leads/store';
import {
  followLinkedInProfile,
  getLinkedInUnipileAccountId,
  resolveLinkedInProfile,
} from '@/lib/signals/outreach/unipile-linkedin';
import {
  checkDailyUsage,
  incrementDailyUsage,
} from '@/lib/social/reliability';
import type { SignalLeadWithContacts } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

const FOLLOW_CHANNEL = 'linkedin_follow' as const;

export interface FollowLeadInput {
  workspaceId: string;
  userId: string;
  leadId: string;
  now?: Date;
}

export interface FollowLeadResult {
  success: boolean;
  error?: string;
  retryAfterSeconds?: number;
  lead?: SignalLeadWithContacts | null;
}

/**
 * Follows a directory lead's primary contact on LinkedIn. Uses the shared safety
 * guard (dry-run, working hours, cooldown, daily cap), per-account daily budget,
 * profile-lookup cap, and a random pause between profile resolve and follow so
 * the two Unipile calls are not chained instantly - per Unipile humanization guidance.
 */
export async function followLeadOnLinkedIn(
  client: InsforgeClient,
  input: FollowLeadInput,
): Promise<FollowLeadResult> {
  const { workspaceId, userId, leadId } = input;

  const guard = await assertOutreachAllowed(client, workspaceId, FOLLOW_CHANNEL, {
    leadId,
    now: input.now,
  });
  if (!guard.allowed) {
    return { success: false, error: guard.reason, retryAfterSeconds: guard.retryAfterSeconds };
  }

  const lead = await getLead(client, workspaceId, leadId);
  if (!lead) return { success: false, error: 'Lead not found.' };

  const contact = lead.primary_contact ?? lead.contacts?.[0] ?? null;
  const identifier =
    lead.outreach?.linkedin_provider_id?.trim() ||
    contact?.linkedin_url?.trim() ||
    contact?.provider_id?.trim();
  if (!identifier) return { success: false, error: 'No LinkedIn profile resolved for this lead.' };

  const accountId = await getLinkedInUnipileAccountId(client, userId, workspaceId);
  if (!accountId) return { success: false, error: 'Connect LinkedIn via Settings before following.' };

  const usage = checkDailyUsage(accountId, 1);
  if (!usage.allowed) {
    return {
      success: false,
      error: 'Daily LinkedIn action budget reached for this account. Follow deferred until tomorrow (UTC).',
    };
  }

  const lookupGuard = await assertLinkedInProfileLookupAllowed(client, workspaceId, { leadId });
  if (!lookupGuard.allowed) {
    return { success: false, error: lookupGuard.reason };
  }

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: 'outreach_send_attempt',
    channel: FOLLOW_CHANNEL,
    lead_id: leadId,
    social_account_id: accountId,
    metadata: { linkedin_identifier: identifier },
  });

  let profile;
  try {
    profile = await resolveLinkedInProfile(accountId, identifier);
    await logSignalAudit(client, {
      workspace_id: workspaceId,
      action: 'profile_lookup',
      channel: FOLLOW_CHANNEL,
      lead_id: leadId,
      social_account_id: accountId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logSignalAudit(client, {
      workspace_id: workspaceId,
      action: 'outreach_blocked',
      channel: FOLLOW_CHANNEL,
      lead_id: leadId,
      social_account_id: accountId,
      blocked_reason: msg,
    });
    return { success: false, error: msg };
  }

  // Random gap between lookup and follow - Unipile: do not chain calls instantly.
  await awaitInterCallDelay();

  const result = await followLinkedInProfile(accountId, profile.providerId);
  if (!result.success) {
    await logSignalAudit(client, {
      workspace_id: workspaceId,
      action: 'outreach_blocked',
      channel: FOLLOW_CHANNEL,
      lead_id: leadId,
      social_account_id: accountId,
      blocked_reason: result.error,
    });
    return { success: false, error: result.error ?? 'Follow failed.' };
  }

  incrementDailyUsage(accountId, 1);

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: 'outreach_send_success',
    channel: FOLLOW_CHANNEL,
    lead_id: leadId,
    social_account_id: accountId,
    metadata: { provider_id: profile.providerId },
  });
  await logLeadEvent(client, workspaceId, leadId, 'rescored', { action: 'followed', channel: FOLLOW_CHANNEL });

  const updated = await getLead(client, workspaceId, leadId);
  return { success: true, lead: updated };
}
