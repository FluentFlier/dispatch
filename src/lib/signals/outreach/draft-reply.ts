import type { createClient } from '@insforge/sdk';
import { generateWithVoicePipeline } from '@/lib/voice-pipeline';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { updateLead } from '@/lib/signals/leads/store';
import { checkAndIncrementUsage } from '@/lib/ai-budget';
import { ensureLeadCompanyDetail } from '@/lib/signals/outreach/draft-lead';
import { loadEditStyleGuidance } from '@/lib/signals/outreach/edit-feedback';
import { buildLeadConversationContext } from '@/lib/signals/leads/inbound-message';
import { meetingLinkPromptLine, normalizeMeetingLink } from '@/lib/signals/leads/meeting-link';
import { getDirectorySettings } from '@/lib/signals/leads/store';
import type { SignalLeadMessageRow } from '@/lib/signals/leads/messages';
import type { LeadPlaybook, SignalLeadWithContacts } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

function formatThread(messages: SignalLeadMessageRow[]): string {
  if (messages.length === 0) return '(No prior messages stored yet.)';
  return messages
    .map((m) => {
      const who = m.direction === 'inbound' ? 'Them' : 'You';
      return `${who}: ${m.body.trim()}`;
    })
    .join('\n');
}

function buildReplyPrompt(
  lead: SignalLeadWithContacts,
  messages: SignalLeadMessageRow[],
  rewriteInstruction?: string | null,
  editGuidance?: string[],
  meetingLinkLine?: string | null,
): string {
  const contact = lead.primary_contact ?? lead.contacts?.[0] ?? null;
  const firstName = contact?.name?.split(' ')[0] ?? null;
  const playbook = lead.playbook as LeadPlaybook | null | undefined;
  const instruction = rewriteInstruction?.trim();

  const lastInbound = [...messages].reverse().find((m) => m.direction === 'inbound');
  const priorOutbound =
    lead.outreach?.final_text?.trim() ||
    lead.outreach?.draft_text?.trim() ||
    null;

  return [
    'Write a LinkedIn direct message reply to continue this sales conversation.',
    'It must sound like a real founder replying in your voice: specific, warm, low-pressure.',
    '',
    'PROSPECT:',
    firstName
      ? `- ${contact!.name}${contact?.role ? ` (${contact.role})` : ''} at ${lead.company_name}`
      : `- Founder at ${lead.company_name}`,
    lead.tagline ? `- What they build: ${lead.tagline.slice(0, 300)}` : null,
    '',
    playbook?.whyThem ? `WHY YOU REACHED OUT: ${playbook.whyThem}` : null,
    playbook?.angle ? `YOUR ANGLE: ${playbook.angle}` : null,
    playbook?.targetPost?.excerpt
      ? `POST YOU COMMENTED ON: "${playbook.targetPost.excerpt.slice(0, 200)}"`
      : null,
    priorOutbound ? `YOUR LAST OUTBOUND MESSAGE: "${priorOutbound.slice(0, 400)}"` : null,
    '',
    'CONVERSATION SO FAR:',
    formatThread(messages),
    '',
    lastInbound ? `THEIR LATEST MESSAGE (reply to this): "${lastInbound.body.slice(0, 500)}"` : null,
    '',
    'THE REPLY MUST:',
    '1. Acknowledge what they said specifically (not generic thanks).',
    '2. Move toward a low-friction next step (quick call, async swap, or clear question).',
    '3. Stay peer-to-peer - never salesy or templated.',
    meetingLinkLine ? '' : null,
    meetingLinkLine,
    '',
    editGuidance?.length
      ? 'STYLE FROM YOUR PAST EDITS (mirror how you rewrite drafts):'
      : null,
    ...(editGuidance?.length ? editGuidance.map((g) => `- ${g}`) : []),
    editGuidance?.length ? '' : null,
    instruction ? 'REWRITE INSTRUCTION (follow exactly):' : null,
    instruction ? `- ${instruction}` : null,
    '',
    'HARD RULES:',
    '- No emojis, hashtags, em dashes, or links unless offering a calendar link at the end.',
    '- 2-4 sentences unless they asked something that needs a bit more.',
    '- Return ONLY the reply text.',
  ]
    .filter(Boolean)
    .join('\n');
}

async function saveReplyDraft(
  client: InsforgeClient,
  workspaceId: string,
  leadId: string,
  draftText: string,
): Promise<void> {
  const { data: existing } = await client.database
    .from('signal_outreach')
    .select('id')
    .eq('lead_id', leadId)
    .limit(1);

  if (existing && existing.length > 0) {
    const { error } = await client.database
      .from('signal_outreach')
      .update({ draft_text: draftText, channel: 'linkedin_dm', status: 'draft', final_text: null })
      .eq('id', (existing[0] as { id: string }).id);
    if (error) throw error;
    return;
  }

  const { error } = await client.database.from('signal_outreach').insert([
    {
      workspace_id: workspaceId,
      lead_id: leadId,
      channel: 'linkedin_dm',
      status: 'draft',
      draft_text: draftText,
    },
  ]);
  if (error) throw error;
}

/**
 * Drafts a reply to the prospect's latest inbound message using full thread
 * context, nurture playbook, and creator voice.
 */
export async function draftReplyForLead(
  client: InsforgeClient,
  userId: string,
  workspaceId: string,
  leadId: string,
  opts: { rewriteInstruction?: string | null; polish?: boolean } = {},
): Promise<{ draftText: string; voiceMatchScore: number }> {
  const budget = await checkAndIncrementUsage(client, workspaceId, 'sonnet');
  if (budget === 'blocked') {
    throw new Error('Daily AI draft budget reached for this workspace. Try again tomorrow.');
  }

  const { messages, lead } = await buildLeadConversationContext(client, workspaceId, leadId);
  if (!lead) throw new Error('Lead not found.');
  if (!lead.needs_reply && messages.filter((m) => m.direction === 'inbound').length === 0) {
    throw new Error('No inbound message to reply to yet.');
  }

  const [voiceContext, companyDetail, editGuidance, directorySettings] = await Promise.all([
    loadCreatorVoiceContext(client, userId, {
      workspaceId,
      platform: 'linkedin',
      lightweight: true,
      includeGtm: true,
    }),
    ensureLeadCompanyDetail(client, workspaceId, lead),
    loadEditStyleGuidance(client, workspaceId, 3),
    getDirectorySettings(client, workspaceId),
  ]);

  const meetingLink = normalizeMeetingLink(directorySettings.meeting_link);
  const meetingLinkLine = meetingLinkPromptLine(meetingLink);

  const polish = opts.polish ?? false;
  const result = await generateWithVoicePipeline({
    userPrompt: buildReplyPrompt(
      lead,
      messages,
      opts.rewriteInstruction,
      editGuidance,
      meetingLinkLine,
    ),
    profile: voiceContext.profile,
    contextAdditions: voiceContext.contextAdditions,
    platform: 'linkedin',
    contentType: 'reply',
    fast: !polish,
    skipHooks: true,
    maxIterations: polish ? 2 : 1,
    humanizeAlways: true,
  });

  const draftText = result.text.trim();
  await saveReplyDraft(client, workspaceId, leadId, draftText);
  await updateLead(client, workspaceId, leadId, { lead_status: 'drafted' });

  void companyDetail;
  return { draftText, voiceMatchScore: result.voice_match_score };
}
