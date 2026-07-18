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
import { fetchXProfile } from '@/lib/signals/profile/x-profile';
import { upsertRawPost } from '@/lib/signals/store';
import { applySignalToLeads } from '@/lib/signals/leads/intent-bridge';
import { logSignalAudit } from '@/lib/signals/safety/audit';
import type { IngestedPost, SignalSourceRow } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

/**
 * Detects field changes (role/tagline/name/description) on a tracked LinkedIn
 * person/company page or X person profile and, for each change found, lands the
 * signal on the matching lead (intent flag + Slack) via applySignalToLeads -
 * NOT the retired signal-events feed.
 *
 * LinkedIn person_profile / company_page sources require a connected Unipile
 * account (profile lookup goes through Unipile). X person_profile sources go
 * through Apify (fetchXProfile) instead; bio rides the shared `headline`
 * snapshot field, so a bio change fires as a person `role_change` like a
 * LinkedIn headline change. First sight of a profile records a baseline
 * snapshot with no signal - a change can only be detected against a prior.
 * Every failure is logged and swallowed.
 */
export async function checkProfileChange(
  client: InsforgeClient,
  workspaceId: string,
  source: SignalSourceRow,
): Promise<{ signalCreated: boolean }> {
  const isLinkedIn =
    source.platform === 'linkedin' &&
    ['person_profile', 'company_page'].includes(source.source_type);
  const isXProfile = source.platform === 'x' && source.source_type === 'person_profile';
  if (!isLinkedIn && !isXProfile) {
    return { signalCreated: false };
  }

  const isCompany = source.source_type === 'company_page';
  let profileKey: string;
  let current: ProfileState;

  if (isXProfile) {
    const profile = await fetchXProfile(source.handle_or_url);
    if (!profile) {
      await logSignalAudit(client, {
        workspace_id: workspaceId,
        action: 'poll_source',
        channel: 'x',
        metadata: { source_id: source.id, handle: source.handle_or_url, profile_lookup_error: 'apify profile lookup returned no data' },
      });
      return { signalCreated: false };
    }
    profileKey = profile.handle;
    current = { profileKey, fullName: profile.name, headline: profile.bio };
  } else {
    if (!unipileConfigured()) return { signalCreated: false };

    const account = await getWorkspacePollAccount(client, workspaceId, 'linkedin');
    if (!account) return { signalCreated: false };

    profileKey = parseLinkedInPublicIdentifier(source.handle_or_url);
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
  }

  const previous = await getProfileSnapshot(client, workspaceId, source.platform, profileKey);
  const classifiedList = detectFieldChanges(previous, current, isCompany ? 'company' : 'person');

  const profileUrl = isXProfile
    ? `https://x.com/${profileKey}`
    : isCompany
      ? `https://www.linkedin.com/company/${profileKey}/`
      : `https://www.linkedin.com/in/${profileKey}/`;

  let anyApplied = false;
  for (const classified of classifiedList) {
    // Change detected: synthesize a raw post capturing the change so the
    // downstream draft has context, then land the signal on the matching lead.
    const post: IngestedPost = {
      platform: source.platform,
      externalPostId: `profile-change:${profileKey}:${classified.dedupeKey}`,
      authorHandle: profileKey,
      authorName: current.fullName,
      content: classified.signalSummary,
      postUrl: profileUrl,
    };

    await upsertRawPost(client, workspaceId, source.id, post);

    // The change lands on the matching lead (intent flag + Slack), not in the
    // retired signal-events feed.
    const bridge = await applySignalToLeads(client, workspaceId, classified, {
      sourceUrl: profileUrl,
    });
    if (bridge.matched + bridge.created > 0) anyApplied = true;
  }

  // Record the current state as the new baseline - once, after all signals
  // for this poll have been processed (first sight or no change: same call).
  await putProfileSnapshot(client, workspaceId, source.platform, current);

  return { signalCreated: anyApplied };
}
