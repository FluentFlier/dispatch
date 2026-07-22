import type { createClient } from '@insforge/sdk';
import type { LeadContactStatus, SignalLeadContactRow, SignalLeadWithContacts } from '@/lib/signals/types';
import { logLeadEvent, updateLead } from '@/lib/signals/leads/store';
import { decideContactStatus } from '@/lib/signals/leads/identity';
import { enrichFounderContact } from '@/lib/signals/leads/enrich-contact';
import { getWorkspaceLinkedInAccountId, searchLinkedInPerson } from '@/lib/signals/outreach/unipile-linkedin';
import type { PersonaTarget } from '@/lib/signals/leads/persona-fit';
import { roleFitsPersona } from '@/lib/signals/leads/persona-fit';

type InsforgeClient = ReturnType<typeof createClient>;

export interface ResolveResult {
  status: LeadContactStatus;
  via?: string;
}

/**
 * Resolves a lead to a definite contact_status. Apify-primary cascade (plan §Phase 2),
 * each step capped, first hit wins:
 *   1. scraped founder URL          → validate (Unipile when available)
 *   2. Apify LinkedIn scrape        → founder-by-name          [gated on APIFY_TOKEN]
 *   3. TinyFish LinkedIn-company    → leadership               [gated on TINYFISH_API_KEY]
 *   4. Unipile name search          → deterministic match      [gated on Unipile account]
 *   5. no_contact
 *
 * Batch sync (fastOnly) also runs Serper founder lookup + Unipile executive search
 * (~1-3s each) before marking no_contact.
 */
export async function resolveLeadContacts(
  client: InsforgeClient,
  workspaceId: string,
  lead: SignalLeadWithContacts,
  opts: { enrich?: boolean; force?: boolean; fastOnly?: boolean; persona?: PersonaTarget | null } = {},
): Promise<ResolveResult> {
  // Enrichment ladder. The batch scrape passes fastOnly:true so only the fast
  // YC-detail lookup runs inline (auto-resolving leads without the slow ~60s
  // agent); on-demand "Try to resolve" runs the full ladder.
  const enrich = opts.enrich ?? true;
  const fastOnly = opts.fastOnly ?? false;
  // force: a user "Rescan" - re-pull fresh founder data even if the lead already
  // has a resolved contact (skips the step-1 short-circuit below).
  const force = opts.force ?? false;
  // Verify the founder's LinkedIn against Unipile at resolve time, but never in
  // the batch/fast path: that would fan out one search call per scraped lead.
  // Cost rule: one verify call only on an explicit (on-demand) resolve.
  const shouldVerify = !fastOnly;
  const contacts = opts.persona
    ? (lead.contacts ?? []).filter((contact) => roleFitsPersona(contact.role, opts.persona!))
    : (lead.contacts ?? []);
  const primary = contacts.find((c) => c.is_primary) ?? contacts[0] ?? null;

  // Step 1: existing scraped/resolved identifier wins (prefers CEO/Founder title).
  // Skipped on a forced rescan so we re-fetch instead of returning the old contact.
  if (!force) {
    const decision = decideContactStatus(contacts);
    if (decision.status === 'resolved' && decision.primaryIndex !== null) {
      const resolvedContact = contacts[decision.primaryIndex];
      await markPrimary(client, resolvedContact);
      if (shouldVerify) {
        await verifyContactLinkedIn(client, workspaceId, resolvedContact, lead.company_name);
      }
      await setStatus(client, workspaceId, lead.id, 'resolved', decision.via);
      return { status: 'resolved', via: decision.via };
    }
  }

  // Steps 2-4: enrichment (gated). When a provider resolves a URL, upsert it
  // onto the contact row and mark resolved. Skipped in batch mode.
  const enriched = enrich
    ? await tryEnrichment(client, workspaceId, lead, primary, fastOnly, shouldVerify, opts.persona)
    : null;
  if (enriched) {
    await setStatus(client, workspaceId, lead.id, 'resolved', enriched);
    return { status: 'resolved', via: enriched };
  }

  // Step 5.
  await setStatus(client, workspaceId, lead.id, 'no_contact');
  return { status: 'no_contact' };
}

/** Promotes the resolvable contact to primary if it isn't already. */
async function markPrimary(client: InsforgeClient, contact: SignalLeadContactRow): Promise<void> {
  if (contact.is_primary) return;
  await client.database.from('signal_lead_contacts').update({ is_primary: false }).eq('lead_id', contact.lead_id);
  await client.database.from('signal_lead_contacts').update({ is_primary: true }).eq('id', contact.id);
}

/**
 * Enrichment cascade: TinyFish company query first, Apify actor fallback (both
 * gated on their creds). On a hit, persists the found LinkedIn URL as a new
 * primary contact and returns the provider name; otherwise null → no_contact.
 */
async function tryEnrichment(
  client: InsforgeClient,
  workspaceId: string,
  lead: SignalLeadWithContacts,
  _primary: SignalLeadContactRow | null,
  fastOnly = false,
  shouldVerify = false,
  persona: PersonaTarget | null = null,
): Promise<string | null> {
  const found = await enrichFounderContact(lead, { fastOnly, client, workspaceId, persona });
  if (!found?.linkedinUrl) return null;

  // Replace any prior enrichment-sourced contact (avoids duplicates on a rescan);
  // done only after a fresh hit, so a failed rescan never destroys a good contact.
  await client.database
    .from('signal_lead_contacts')
    .delete()
    .eq('lead_id', lead.id)
    .eq('resolution_source', 'enriched');
  await client.database.from('signal_lead_contacts').update({ is_primary: false }).eq('lead_id', lead.id);
  const { data: insertedRows } = await client.database
    .from('signal_lead_contacts')
    .insert([
      {
        lead_id: lead.id,
        workspace_id: workspaceId,
        name: found.name ?? null,
        role: found.role ?? null,
        linkedin_url: found.linkedinUrl,
        resolution_source: 'enriched',
        enriched_via: found.via,
        is_primary: true,
      },
    ])
    .select('id');

  // Verify the freshly enriched URL against Unipile (on-demand resolve only).
  const insertedId = (insertedRows?.[0] as { id?: string } | undefined)?.id;
  if (shouldVerify && insertedId) {
    await verifyContactLinkedIn(
      client,
      workspaceId,
      { id: insertedId, name: found.name ?? null, linkedin_url: found.linkedinUrl },
      lead.company_name,
    );
  }
  return found.via;
}

/**
 * Verifies a resolved contact's LinkedIn against the workspace's connected
 * Unipile account with a single people-search call (at resolve time only, never
 * per render). Sets linkedin_verified + timestamp when Unipile confirms the
 * founder; leaves it false when no account is connected or nothing is found.
 *
 * Never blocks resolution: an unverified contact is still resolved (just flagged
 * unverified so the UI and outreach path can surface it). Best-effort - any
 * failure degrades to unverified rather than throwing.
 */
export async function verifyContactLinkedIn(
  client: InsforgeClient,
  workspaceId: string,
  contact: Pick<SignalLeadContactRow, 'id' | 'name' | 'linkedin_url'>,
  companyName: string,
): Promise<boolean> {
  if (!contact.id || !contact.linkedin_url?.trim()) return false;

  const accountId = await getWorkspaceLinkedInAccountId(client, workspaceId);
  // No connected LinkedIn account to search from: cannot verify. Leave the flag
  // untouched (default false) and do NOT block - the lead stays resolved.
  if (!accountId) return false;

  let verified = false;
  try {
    const hit = await searchLinkedInPerson({
      name: contact.name ?? '',
      company: companyName,
      accountId,
    });
    verified = Boolean(hit?.linkedinUrl);
  } catch {
    // Unipile down/unconfigured: treat as unverified, never throw into resolve.
    verified = false;
  }

  await client.database
    .from('signal_lead_contacts')
    .update({
      linkedin_verified: verified,
      linkedin_verified_at: verified ? new Date().toISOString() : null,
    })
    .eq('id', contact.id);
  return verified;
}

/** Persists contact_status + logs a resolved/unresolved lead event. */
async function setStatus(
  client: InsforgeClient,
  workspaceId: string,
  leadId: string,
  status: LeadContactStatus,
  via?: string,
): Promise<void> {
  await updateLead(client, workspaceId, leadId, { contact_status: status });
  await logLeadEvent(
    client,
    workspaceId,
    leadId,
    status === 'resolved' ? 'resolved' : 'unresolved',
    via ? { via } : {},
  );
}
