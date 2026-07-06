import type { createClient } from '@insforge/sdk';
import { generateWithVoicePipeline } from '@/lib/voice-pipeline';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { updateLead } from '@/lib/signals/leads/store';
import { enforceConnectLimit } from '@/lib/signals/outreach/enforce-limit';
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
  const firstName = contact?.name ? contact.name.split(' ')[0] : null;
  const detail = lead.tagline || (lead.source_fact as { tagline?: string })?.tagline || null;

  return [
    `Write a ${channelLabel(channel)} to a startup founder. It must read like a real,`,
    `thoughtful note from one founder to another: specific, warm, and low-pressure —`,
    `good enough to send as-is with zero edits.`,
    '',
    'WHO YOU ARE MESSAGING:',
    firstName
      ? `- Founder: ${contact!.name}${contact?.role ? ` (${contact.role})` : ''} — address them as "${firstName}".`
      : `- A founder at ${lead.company_name} (name unknown — do NOT invent one; open with the company/what they build).`,
    `- Company: ${lead.company_name}`,
    detail ? `- What they build: ${detail}` : null,
    lead.batch ? `- ${sourceLabel} batch: ${lead.batch}` : `- Discovered via ${sourceLabel}`,
    Array.isArray(lead.tags) && lead.tags.length ? `- Space: ${lead.tags.slice(0, 3).join(', ')}` : null,
    lead.intent_flags?.raised ? '- Signal: recently raised funding' : null,
    '',
    'THE MESSAGE MUST:',
    '1. Open with a specific, genuine observation about THEM or what they build — reference a concrete detail above, not generic praise.',
    '2. Give one authentic reason you are reaching out (a real overlap or shared interest), not a pitch.',
    '3. End with a light, specific ask (swap notes / a quick chat), no hard sell.',
    '',
    'HARD RULES:',
    '- Human and peer-to-peer. Never salesy, never templated.',
    '- BANNED openers: "I came across", "I hope this finds you well", "As a fellow", "I noticed".',
    '- No emojis, no hashtags, no em dashes, no links, no mention of AI, automation, or tools.',
    channel === 'linkedin_connect'
      ? '- HARD LIMIT 300 characters total. Every word must earn its place.'
      : '- Keep it tight: 3-5 sentences.',
    'Return ONLY the message text, nothing else.',
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
    // Quality over speed for a one-shot outreach line: run the critique/revise
    // loop (fast:false) with an extra pass so a weak first draft gets improved.
    fast: false,
    skipHooks: true,
    maxIterations: 2,
    humanizeAlways: true,
  });

  // The 300-char instruction above is a soft prompt; the model can and does
  // overrun it. Enforce the hard limit server-side so every saved connect
  // note is guaranteed sendable regardless of what the LLM returned.
  const draftText = channel === 'linkedin_connect' ? enforceConnectLimit(result.text) : result.text;

  await saveLeadDraft(client, workspaceId, lead.id, draftText, channel);
  await updateLead(client, workspaceId, lead.id, { lead_status: 'drafted' });

  return { draftText, voiceMatchScore: result.voice_match_score };
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
