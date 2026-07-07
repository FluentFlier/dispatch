import type { createClient } from '@insforge/sdk';
import { generateWithVoicePipeline } from '@/lib/voice-pipeline';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { updateLead } from '@/lib/signals/leads/store';
import { enforceConnectLimit } from '@/lib/signals/outreach/enforce-limit';
import { checkAndIncrementUsage } from '@/lib/ai-budget';
import { fetchYcCompanyDetail } from '@/lib/signals/ingest/yc-algolia';
import { withTimeout } from '@/lib/util/timeout';
import type {
  LeadCompanyDetail,
  OutreachChannel,
  SignalLeadContactRow,
  SignalLeadWithContacts,
} from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

/** Time budget for the one-time YC detail-page fetch during a draft. */
const COMPANY_DETAIL_TIMEOUT_MS = 3500;

/**
 * Returns the lead's rich company detail for the prompt, fetching the YC detail
 * page at most ONCE per lead and persisting it (`fetchedAt` marks a full fetch).
 * Repeat drafts reuse the stored value with no re-scrape. Seed-only detail (from
 * ingest: description + industries, no fetchedAt) triggers exactly one fetch to
 * fill headcount/status; a persisted `fetchedAt` short-circuits the fetch.
 */
export async function ensureLeadCompanyDetail(
  client: InsforgeClient,
  workspaceId: string,
  lead: SignalLeadWithContacts,
): Promise<LeadCompanyDetail | null> {
  const existing = (lead.company_detail as LeadCompanyDetail | null | undefined) ?? null;
  // Already fully fetched once — reuse, never re-scrape.
  if (existing?.fetchedAt) return existing;
  // Only YC leads have a detail page to complete from.
  if (lead.source !== 'yc_directory' || !lead.external_id) return existing;

  const detail = await withTimeout(
    fetchYcCompanyDetail(lead.external_id),
    COMPANY_DETAIL_TIMEOUT_MS,
    null,
  );
  if (!detail) return existing;

  const compact: LeadCompanyDetail = {
    description: detail.description ?? existing?.description,
    teamSize: detail.teamSize,
    industries: detail.industries?.length ? detail.industries.slice(0, 6) : existing?.industries,
    location: detail.location,
    status: detail.status,
    yearFounded: detail.yearFounded,
    fetchedAt: new Date().toISOString(),
  };
  await updateLead(client, workspaceId, lead.id, { company_detail: compact });
  return compact;
}

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
  rewriteInstruction?: string | null,
  company?: LeadCompanyDetail | null,
): string {
  const sourceLabel = lead.source === 'product_hunt' ? 'Product Hunt' : 'YC';
  const firstName = contact?.name ? contact.name.split(' ')[0] : null;
  const instruction = rewriteInstruction?.trim();

  // Prefer the richer persisted description; fall back to tagline/source_fact.
  const description =
    company?.description?.trim() ||
    lead.tagline ||
    (lead.source_fact as { tagline?: string })?.tagline ||
    null;
  const industries = company?.industries?.length
    ? company.industries
    : Array.isArray(lead.tags)
      ? lead.tags
      : [];

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
    // Cap the description so a long one does not bloat the prompt (latency).
    description ? `- What they build: ${description.slice(0, 400)}` : null,
    company?.teamSize ? `- Team size: ~${company.teamSize} people` : null,
    industries.length ? `- Industry: ${industries.slice(0, 3).join(', ')}` : null,
    company?.status ? `- Stage: ${company.status}` : null,
    lead.batch ? `- ${sourceLabel} batch: ${lead.batch}` : `- Discovered via ${sourceLabel}`,
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
    // User's rewrite instruction (e.g. "shorter, more casual") takes priority
    // over the default style rules where they conflict.
    instruction ? '' : null,
    instruction ? 'REWRITE INSTRUCTION (follow this exactly; it overrides the style defaults above where they conflict):' : null,
    instruction ? `- ${instruction}` : null,
    'Return ONLY the message text, nothing else.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Voice-pipeline settings for a lead draft.
 *
 * The interactive first render uses the FAST path (base + light humanize, no
 * evaluate/revise loop) so it returns in a few seconds instead of the ~4-8
 * sequential LLM round-trips the full loop needs. An explicit "polish" pass
 * runs the heavy voice + critique loop for a higher-fidelity rewrite.
 */
export function draftPipelineOptions(polish: boolean): {
  fast: boolean;
  maxIterations: number;
  humanizeAlways: boolean;
  skipHooks: boolean;
} {
  return polish
    ? { fast: false, maxIterations: 2, humanizeAlways: true, skipHooks: true }
    : { fast: true, maxIterations: 1, humanizeAlways: true, skipHooks: true };
}

/**
 * Drafts an outreach message for a directory lead in the creator's voice and
 * saves it against the lead (signal_outreach.lead_id). Reuses the same voice
 * pipeline + GTM playbook as event drafting. Transitions the lead to `drafted`.
 *
 * Interactive by default (fast path). Pass `opts.polish` for the full quality
 * loop. Wall-clock is logged as `[latency] lead-draft ...` for measurement.
 */
export async function draftOutreachForLead(
  client: InsforgeClient,
  userId: string,
  workspaceId: string,
  lead: SignalLeadWithContacts,
  channel: OutreachChannel = 'linkedin_connect',
  opts: { rewriteInstruction?: string | null; polish?: boolean } = {},
): Promise<{ draftText: string; voiceMatchScore: number }> {
  const startedAt = Date.now();
  const platform = channel === 'x_dm' ? 'twitter' : channel.startsWith('linkedin') ? 'linkedin' : undefined;
  const contact = lead.primary_contact ?? lead.contacts?.[0] ?? null;

  // Per-workspace daily budget gate: each lead draft runs the full voice pipeline
  // (several provider calls). Bulk-drafting leads would otherwise be uncapped spend.
  const budget = await checkAndIncrementUsage(client, workspaceId, 'sonnet');
  if (budget === 'blocked') {
    throw new Error('Daily AI draft budget reached for this workspace. Try again tomorrow.');
  }

  const voiceContext = await loadCreatorVoiceContext(client, userId, {
    workspaceId,
    platform,
    lightweight: true,
    includeGtm: true,
  });

  // Load (or one-time fetch + persist) rich company facts so the prompt has real
  // substance without a re-scrape on repeat drafts.
  const companyDetail = await ensureLeadCompanyDetail(client, workspaceId, lead);

  // Fast path for the interactive first render; heavy loop only on polish.
  const pipe = draftPipelineOptions(opts.polish ?? false);
  const result = await generateWithVoicePipeline({
    userPrompt: buildLeadPrompt(lead, contact, channel, opts.rewriteInstruction, companyDetail),
    profile: voiceContext.profile,
    contextAdditions: voiceContext.contextAdditions,
    platform,
    contentType: 'reply',
    fast: pipe.fast,
    skipHooks: pipe.skipHooks,
    maxIterations: pipe.maxIterations,
    humanizeAlways: pipe.humanizeAlways,
  });

  // The 300-char instruction above is a soft prompt; the model can and does
  // overrun it. Enforce the hard limit server-side so every saved connect
  // note is guaranteed sendable regardless of what the LLM returned.
  const draftText = channel === 'linkedin_connect' ? enforceConnectLimit(result.text) : result.text;

  await saveLeadDraft(client, workspaceId, lead.id, draftText, channel);
  await updateLead(client, workspaceId, lead.id, { lead_status: 'drafted' });

  // Instrumentation: wall-clock so the 10-20s budget can be verified in logs.
  console.info(
    `[latency] lead-draft workspace=${workspaceId} lead=${lead.id} polish=${opts.polish ? 1 : 0} ms=${Date.now() - startedAt}`,
  );

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
