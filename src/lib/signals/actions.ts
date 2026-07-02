import type { createClient } from '@insforge/sdk';
import { getSafetySettings } from '@/lib/signals/safety/settings';
import { assertAutoSendAllowed } from '@/lib/signals/safety/guard';
import { logSignalAudit } from '@/lib/signals/safety/audit';
import { draftOutreachForEvent } from '@/lib/signals/outreach/draft';
import { sendSignalOutreach } from '@/lib/signals/outreach/send';
import {
  getWorkspacePollAccount,
  getWorkspaceOwnerUserId,
} from '@/lib/signals/ingest/workspace-account';
import type {
  OutreachChannel,
  SignalEventWithPost,
  SignalPlatform,
  SignalSourceType,
} from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

/** Default outreach channel per platform (LinkedIn connection note is the safe default). */
function channelForPlatform(platform: SignalPlatform): OutreachChannel {
  return platform === 'x' ? 'x_dm' : 'linkedin_connect';
}

export interface SignalActionContext {
  platform: SignalPlatform;
  /** Present only for polled sources; absent for webhook/manual ingest (auto-send stays off then). */
  sourceType?: SignalSourceType;
}

/**
 * Post-detection action pipeline for a newly created signal. Translates the
 * spec's action modes onto the live workspace safety posture so there is no
 * separate rules table to keep in sync:
 *   - outreach_enabled = false → notify only (the Slack alert already fired at
 *     event creation; nothing more happens here). This is the default posture.
 *   - outreach_enabled = true  → auto-generate an outreach draft in the creator's
 *     voice (the spec's notify_and_draft).
 *   - auto_send_enabled = true → additionally auto-send (the spec's auto_send),
 *     but ONLY to tracked LinkedIn person profiles and ONLY when the safety guard
 *     (daily/weekly caps, cooldown, working hours, dry-run) allows. Company and
 *     accelerator sources never auto-send — the post author is the org, not the
 *     founder we want to reach, so those always stay draft-only for manual review.
 *
 * Fully defensive: every branch logs to the audit trail, and any failure is
 * swallowed so one signal's action can never break the sync batch. Both toggles
 * default to false, so the default behavior is unchanged (notify only).
 */
export async function runSignalActions(
  client: InsforgeClient,
  workspaceId: string,
  event: SignalEventWithPost,
  ctx: SignalActionContext,
): Promise<void> {
  try {
    const settings = await getSafetySettings(client, workspaceId);
    if (!settings.outreach_enabled) return; // notify_only — nothing to do

    const platform = ctx.platform;
    const channel = channelForPlatform(platform);

    // Acting user: the connected account owner for this platform, else the
    // workspace owner (draft-only — a real send requires a connected account).
    const account = await getWorkspacePollAccount(client, workspaceId, platform);
    const userId = account?.userId ?? (await getWorkspaceOwnerUserId(client, workspaceId));
    if (!userId) {
      await logSignalAudit(client, {
        workspace_id: workspaceId,
        action: 'auto_action_skipped',
        event_id: event.id,
        blocked_reason: 'No workspace user available to draft as.',
      });
      return;
    }

    // --- Auto-draft (notify_and_draft) ---
    let draftText: string;
    try {
      const drafted = await draftOutreachForEvent(client, userId, workspaceId, event, channel);
      draftText = drafted.draftText;
      await logSignalAudit(client, {
        workspace_id: workspaceId,
        action: 'auto_draft',
        channel,
        event_id: event.id,
      });
    } catch (err) {
      await logSignalAudit(client, {
        workspace_id: workspaceId,
        action: 'auto_draft_failed',
        channel,
        event_id: event.id,
        blocked_reason: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // --- Auto-send (auto_send) — guarded, LinkedIn person-profiles only ---
    if (!settings.auto_send_enabled) return; // drafted; awaits manual approval

    if (platform === 'x') {
      await logSignalAudit(client, {
        workspace_id: workspaceId,
        action: 'auto_send_skipped',
        channel,
        event_id: event.id,
        blocked_reason: 'X DM auto-send is not wired yet.',
      });
      return;
    }

    if (ctx.sourceType !== 'person_profile') {
      await logSignalAudit(client, {
        workspace_id: workspaceId,
        action: 'auto_send_skipped',
        channel,
        event_id: event.id,
        blocked_reason: 'Auto-send only fires for tracked person profiles, not company/accelerator sources.',
      });
      return;
    }

    const linkedinIdentifier = event.raw_post?.author_handle?.trim();
    if (!linkedinIdentifier) {
      await logSignalAudit(client, {
        workspace_id: workspaceId,
        action: 'auto_send_skipped',
        channel,
        event_id: event.id,
        blocked_reason: 'No resolvable LinkedIn target identifier on the source post.',
      });
      return;
    }

    // assertAutoSendAllowed enforces auto_send_enabled + all manual gates (caps,
    // cooldown, hours, dry-run) and logs its own block reason. On block the draft
    // stays for manual review.
    const guard = await assertAutoSendAllowed(client, workspaceId, channel);
    if (!guard.allowed) return;

    await sendSignalOutreach(client, {
      workspaceId,
      userId,
      eventId: event.id,
      channel,
      linkedinIdentifier,
      messageText: draftText,
    });
  } catch (err) {
    // Never let an action failure break the ingest batch.
    console.warn('[signals/actions] pipeline error', {
      workspaceId,
      eventId: event.id,
      err,
    });
  }
}
