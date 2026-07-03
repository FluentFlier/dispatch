import type { createClient } from '@insforge/sdk';
import { generateWithVoicePipeline } from '@/lib/voice-pipeline';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { updateLead } from '@/lib/signals/leads/store';
import type { OutreachChannel, SignalLeadContactRow, SignalLeadWithContacts } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

/** Directory leads default to a LinkedIn connection note. */
function channelLabel(channel: OutreachChannel): string {
  switch (channel) {
    case 'linkedin_connect':
      return 'LinkedIn connection note (300 char max)';
    case 'linkedin_dm':
      return 'LinkedIn direct message';
    case 'x_dm':
      return 'X/Twitter direct message';
    case 'gmail':
      return 'professional cold email (under 120 words)';
    case 'copy':
      return 'short outreach message to copy';
    default: {
      const _exhaustive: never = channel;
      return _exhaustive;
    }
  }
}

/** Builds the voice-pipeline prompt from lead + contact context (no post body). */
function buildLeadPrompt(
  lead: SignalLeadWithContacts,
  contact: SignalLeadContactRow | null,
  channel: OutreachChannel,
): string {
  const sourceLabel = lead.source === 'product_hunt' ? 'Product Hunt' : 'YC';
  return [
    `Write a ${channelLabel(channel)} for GTM outreach to a startup founder.`,
    '',
    'CONTEXT:',
    `- Company: ${lead.company_name}`,
    lead.tagline ? `- What they do: ${lead.tagline}` : null,
    lead.batch ? `- ${sourceLabel} batch: ${lead.batch}` : `- Source: ${sourceLabel}`,
    contact?.name ? `- Founder: ${contact.name}${contact.role ? ` (${contact.role})` : ''}` : null,
    lead.intent_flags?.raised ? '- Signal: recently raised funding' : null,
    '',
    'RULES:',
    '- Reference the concrete signal (e.g. "saw you joined YC S24" or their launch).',
    '- Sound like a founder-friendly peer, not a bot. 2-4 sentences.',
    '- No "I came across your profile" spam. No em dashes. No mention of AI/automation.',
    channel === 'linkedin_connect' ? '- Hard limit 300 characters.' : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Drafts an outreach message for a directory lead in the creator's voice and
 * saves it against the lead (signal_outreach.lead_id). Reuses the same voice
 * pipeline + GTM playbook as event drafting. Transitions the lead to `drafted`.
 */
export async function draftOutreachForLead(
  client: InsforgeClient,
  userId: string,
  workspaceId: string,
  lead: SignalLeadWithContacts,
  channel: OutreachChannel = 'linkedin_connect',
): Promise<{ draftText: string; voiceMatchScore: number }> {
  const platform = channel === 'x_dm' ? 'twitter' : channel.startsWith('linkedin') ? 'linkedin' : undefined;
  const contact = lead.primary_contact ?? lead.contacts?.[0] ?? null;

  const voiceContext = await loadCreatorVoiceContext(client, userId, {
    workspaceId,
    platform,
    lightweight: true,
    includeGtm: true,
  });

  const result = await generateWithVoicePipeline({
    userPrompt: buildLeadPrompt(lead, contact, channel),
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

  await saveLeadDraft(client, workspaceId, lead.id, result.text, channel);
  await updateLead(client, workspaceId, lead.id, { lead_status: 'drafted' });

  return { draftText: result.text, voiceMatchScore: result.voice_match_score };
}

/** Upserts the single outreach draft row for a lead (unique on lead_id). */
async function saveLeadDraft(
  client: InsforgeClient,
  workspaceId: string,
  leadId: string,
  draftText: string,
  channel: OutreachChannel,
): Promise<void> {
  const { data: existing } = await client.database
    .from('signal_outreach')
    .select('id')
    .eq('lead_id', leadId)
    .limit(1);

  if (existing && existing.length > 0) {
    const { error } = await client.database
      .from('signal_outreach')
      .update({ draft_text: draftText, channel, status: 'draft', final_text: null })
      .eq('id', (existing[0] as { id: string }).id);
    if (error) throw error;
    return;
  }

  const { error } = await client.database.from('signal_outreach').insert([
    { workspace_id: workspaceId, lead_id: leadId, channel, status: 'draft', draft_text: draftText },
  ]);
  if (error) throw error;
}
