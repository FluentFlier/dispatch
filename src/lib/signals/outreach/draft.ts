import type { createClient } from '@insforge/sdk';
import { generateWithVoicePipeline } from '@/lib/voice-pipeline';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { saveOutreachDraft, getEvent } from '@/lib/signals/store';
import { enforceConnectLimit } from '@/lib/signals/outreach/enforce-limit';
import { detectRelationshipTier, outreachFrameworkBlock } from '@/lib/signals/outreach/framework';
import { checkAndIncrementUsage } from '@/lib/ai-budget';
import type { SignalEventWithPost, OutreachChannel } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

function channelLabel(channel: OutreachChannel): string {
  switch (channel) {
    case 'linkedin_connect':
      return 'LinkedIn connection note (300 char max)';
    case 'linkedin_dm':
      return 'LinkedIn direct message';
    case 'linkedin_comment':
      return 'short, genuine comment on their recent LinkedIn post';
    case 'linkedin_follow':
      return 'LinkedIn connection note (300 char max)';
    case 'x_dm':
      return 'X/Twitter direct message';
    case 'copy':
      return 'short outreach message to copy';
    case 'gmail':
      return 'professional cold email (under 120 words)';
    default: {
      const _exhaustive: never = channel;
      return _exhaustive;
    }
  }
}

function buildOutreachPrompt(event: SignalEventWithPost, channel: OutreachChannel): string {
  const post = event.raw_post;
  const parts = [
    `Write a ${channelLabel(channel)} for GTM outreach.`,
    '',
    'CONTEXT:',
    `- Signal type: ${event.signal_type}`,
    event.company_name ? `- Company: ${event.company_name}` : null,
    event.person_name ? `- Person: ${event.person_name}` : null,
    event.accelerator_name ? `- Accelerator: ${event.accelerator_name}` : null,
    event.batch ? `- Batch: ${event.batch}` : null,
    event.signal_summary ? `- Summary: ${event.signal_summary}` : null,
    post?.content ? `- Original post:\n${post.content.slice(0, 600)}` : null,
    post?.post_url ? `- Post URL: ${post.post_url}` : null,
    '',
    outreachFrameworkBlock(detectRelationshipTier({})),
    '',
    'RULES:',
    '- Sound like a real founder-friendly GTM rep, not a bot.',
    '- Reference the specific signal (YC batch, funding, launch).',
    '- 2-5 sentences. No "I came across your profile" spam.',
    '- No em dashes.',
    '- Do not mention AI or automation.',
  ].filter(Boolean);

  return parts.join('\n');
}

export async function draftOutreachForEvent(
  client: InsforgeClient,
  userId: string,
  workspaceId: string,
  event: SignalEventWithPost,
  channel: OutreachChannel = 'copy',
): Promise<{ draftText: string; voiceMatchScore: number; event: SignalEventWithPost | null }> {
  const platform =
    channel === 'x_dm' ? 'twitter' : channel.startsWith('linkedin') ? 'linkedin' : undefined;

  // Per-workspace daily budget gate: each draft runs the full voice pipeline
  // (several provider calls). Fan-out drafting across many signals/leads would
  // otherwise be uncapped provider spend.
  const budget = await checkAndIncrementUsage(client, workspaceId, 'sonnet');
  if (budget === 'blocked') {
    throw new Error('Daily AI draft budget reached for this workspace. Try again tomorrow.');
  }

  const voiceContext = await loadCreatorVoiceContext(client, userId, {
    workspaceId,
    platform,
    lightweight: true,
    // Outreach drafts must carry the GTM playbook (ICP/pitch/CTA). Without this the
    // brain block is skipped and drafts generate with voice but no sales awareness.
    includeGtm: true,
    // Draft in the sender's real voice from their best-available channel
    // (Gmail > LinkedIn > X), latest 15 samples.
    outreachVoicePriority: true,
  });

  const result = await generateWithVoicePipeline({
    userPrompt: buildOutreachPrompt(event, channel),
    profile: voiceContext.profile,
    contextAdditions: voiceContext.contextAdditions,
    platform,
    contentType: 'reply',
    fast: true,
    preferOpenAi: true,
    skipHooks: true,
    maxIterations: 1,
    humanizeAlways: false,
  });

  // The connect-note prompt only asks for <= 300 chars; enforce it server-side
  // so an overrun LLM response never produces an unsendable saved draft.
  const draftText = channel === 'linkedin_connect' ? enforceConnectLimit(result.text) : result.text;

  await saveOutreachDraft(client, workspaceId, event.id, draftText, channel);

  const updated = await getEvent(client, workspaceId, event.id);

  return {
    draftText,
    voiceMatchScore: result.voice_match_score,
    event: updated,
  };
}
