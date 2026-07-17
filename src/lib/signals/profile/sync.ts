import type { createClient } from '@insforge/sdk';
import { getWorkspacePollAccount } from '@/lib/signals/ingest/workspace-account';
import {
  parseLinkedInPublicIdentifier,
  resolveLinkedInProfile,
} from '@/lib/signals/outreach/unipile-linkedin';
import { unipileConfigured } from '@/lib/signals/ingest/unipile-fetch';
import { detectRoleChange, normalizeHeadline, type ProfileState } from '@/lib/signals/profile/detect';
import { getProfileSnapshot, putProfileSnapshot } from '@/lib/signals/profile/store';
import { upsertRawPost } from '@/lib/signals/store';
import { applySignalToLeads } from '@/lib/signals/leads/intent-bridge';
import { logSignalAudit } from '@/lib/signals/safety/audit';
import type { IngestedPost, SignalSourceRow } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

/**
 * Detects a job-title/role change on a tracked LinkedIn person profile and, when
 * found, creates a role_change signal and runs the action pipeline for it.
 *
 * Only meaningful for LinkedIn person_profile sources, and only when a Unipile
 * account is connected (profile lookup goes through Unipile). First sight of a
 * profile records a baseline snapshot with no signal - a change can only be
 * detected against a prior. Every failure is logged and swallowed.
 */
export async function checkProfileChange(
  client: InsforgeClient,
  workspaceId: string,
  source: SignalSourceRow,
): Promise<{ signalCreated: boolean }> {
  if (source.platform !== 'linkedin' || source.source_type !== 'person_profile') {
    return { signalCreated: false };
  }
  if (!unipileConfigured()) return { signalCreated: false };

  const account = await getWorkspacePollAccount(client, workspaceId, 'linkedin');
  if (!account) return { signalCreated: false };

  const profileKey = parseLinkedInPublicIdentifier(source.handle_or_url);

  let current: ProfileState;
  try {
    const profile = await resolveLinkedInProfile(account.unipileAccountId, source.handle_or_url);
    const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
    current = {
      profileKey,
      providerId: profile.providerId,
      fullName: fullName || undefined,
      headline: profile.headline,
    };
  } catch (err) {
    await logSignalAudit(client, {
      workspace_id: workspaceId,
      action: 'poll_source',
      channel: 'linkedin',
      metadata: { source_id: source.id, profile_key: profileKey, profile_lookup_error: String(err) },
    });
    return { signalCreated: false };
  }

  const previous = await getProfileSnapshot(client, workspaceId, 'linkedin', profileKey);
  const classified = detectRoleChange(previous, current);

  if (!classified) {
    // No change (or first-sight baseline) - record the current state and stop.
    await putProfileSnapshot(client, workspaceId, 'linkedin', current);
    return { signalCreated: false };
  }

  // Change detected: synthesize a raw post capturing the new headline so the
  // event carries context for drafting, then classify + run actions.
  const post: IngestedPost = {
    platform: 'linkedin',
    externalPostId: `profile-change:${profileKey}:${normalizeHeadline(current.headline)}`,
    authorHandle: profileKey,
    authorName: current.fullName,
    content: `Profile update: ${current.headline}`,
    postUrl: `https://www.linkedin.com/in/${profileKey}/`,
  };

  await upsertRawPost(client, workspaceId, source.id, post);
  await putProfileSnapshot(client, workspaceId, 'linkedin', current);

  // The role change lands on the matching lead (intent flag + Slack), not in
  // the retired signal-events feed.
  const bridge = await applySignalToLeads(client, workspaceId, classified, {
    sourceUrl: post.postUrl,
  });
  return { signalCreated: bridge.matched + bridge.created > 0 };
}
