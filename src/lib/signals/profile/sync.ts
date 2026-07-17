import type { createClient } from '@insforge/sdk';
import { getWorkspacePollAccount } from '@/lib/signals/ingest/workspace-account';
import {
  parseLinkedInPublicIdentifier,
  resolveLinkedInCompany,
  resolveLinkedInProfile,
} from '@/lib/signals/outreach/unipile-linkedin';
import { unipileConfigured } from '@/lib/signals/ingest/unipile-fetch';
import { detectFieldChanges, type ProfileState } from '@/lib/signals/profile/detect';
import { getProfileSnapshot, putProfileSnapshot } from '@/lib/signals/profile/store';
import { createSignalEvent, getEvent, upsertRawPost } from '@/lib/signals/store';
import { runSignalActions } from '@/lib/signals/actions';
import { resolveRuleAction } from '@/lib/signals/rules/match';
import { logSignalAudit } from '@/lib/signals/safety/audit';
import type { IngestedPost, SignalRuleRow, SignalSourceRow } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

/**
 * Detects field changes (role/tagline/name/description) on a tracked LinkedIn
 * person or company page and, for each change found, creates a signal event
 * and runs the action pipeline for it.
 *
 * Only meaningful for LinkedIn person_profile / company_page sources, and only
 * when a Unipile account is connected (profile lookup goes through Unipile).
 * First sight of a profile records a baseline snapshot with no signal - a
 * change can only be detected against a prior. Every failure is logged and
 * swallowed.
 */
export async function checkProfileChange(
  client: InsforgeClient,
  workspaceId: string,
  source: SignalSourceRow,
  rules: SignalRuleRow[],
): Promise<{ signalCreated: boolean }> {
  if (
    source.platform !== 'linkedin' ||
    !['person_profile', 'company_page'].includes(source.source_type)
  ) {
    return { signalCreated: false };
  }
  if (!unipileConfigured()) return { signalCreated: false };

  const account = await getWorkspacePollAccount(client, workspaceId, 'linkedin');
  if (!account) return { signalCreated: false };

  const profileKey = parseLinkedInPublicIdentifier(source.handle_or_url);
  const isCompany = source.source_type === 'company_page';

  let current: ProfileState;
  try {
    if (isCompany) {
      const company = await resolveLinkedInCompany(account.unipileAccountId, source.handle_or_url);
      current = {
        profileKey,
        providerId: company.providerId,
        fullName: company.name,
        headline: company.tagline,
        description: company.description,
      };
    } else {
      const profile = await resolveLinkedInProfile(account.unipileAccountId, source.handle_or_url);
      const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
      current = {
        profileKey,
        providerId: profile.providerId,
        fullName: fullName || undefined,
        headline: profile.headline,
        description: profile.description,
      };
    }
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
  const classifiedList = detectFieldChanges(previous, current, isCompany ? 'company' : 'person');

  const profileUrl = isCompany
    ? `https://www.linkedin.com/company/${profileKey}/`
    : `https://www.linkedin.com/in/${profileKey}/`;

  let anyCreated = false;
  for (const classified of classifiedList) {
    // Change detected: synthesize a raw post capturing the change so the
    // event carries context for drafting, then classify + run actions.
    const post: IngestedPost = {
      platform: 'linkedin',
      externalPostId: `profile-change:${profileKey}:${classified.dedupeKey}`,
      authorHandle: profileKey,
      authorName: current.fullName,
      content: classified.signalSummary,
      postUrl: profileUrl,
    };

    const rawPostId = await upsertRawPost(client, workspaceId, source.id, post);
    const { created, eventId } = await createSignalEvent(client, workspaceId, rawPostId, classified);

    if (created && eventId) {
      const event = await getEvent(client, workspaceId, eventId);
      if (event) {
        const resolution = resolveRuleAction(
          rules,
          { platform: 'linkedin', sourceType: source.source_type },
          classified,
        );
        await runSignalActions(client, workspaceId, event, {
          platform: 'linkedin',
          sourceType: source.source_type,
          actionMode: resolution.actionMode ?? undefined,
          channels: resolution.channels,
        });
      }
      anyCreated = true;
    }
  }

  // Record the current state as the new baseline - once, after all signals
  // for this poll have been processed (first sight or no change: same call).
  await putProfileSnapshot(client, workspaceId, 'linkedin', current);

  return { signalCreated: anyCreated };
}
