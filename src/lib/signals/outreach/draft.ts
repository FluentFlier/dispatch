import type { createClient } from '@insforge/sdk';
import { generateWithVoicePipeline } from '@/lib/voice-pipeline';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { saveOutreachDraft, getEvent } from '@/lib/signals/store';
import type { SignalEventWithPost, OutreachChannel } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

function channelLabel(channel: OutreachChannel): string {
  switch (channel) {
    case 'linkedin_connect':
      return 'LinkedIn connection note (300 char max)';
    case 'linkedin_dm':
      return 'LinkedIn direct message';
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

  const voiceContext = await loadCreatorVoiceContext(client, userId, {
    workspaceId,
    platform,
    lightweight: true,
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

  await saveOutreachDraft(client, workspaceId, event.id, result.text, channel);

  const updated = await getEvent(client, workspaceId, event.id);

  return {
    draftText: result.text,
    voiceMatchScore: result.voice_match_score,
    event: updated,
  };
}
