import type { createClient } from '@insforge/sdk';
import type { LeadContactStatus, SignalLeadContactRow, SignalLeadWithContacts } from '@/lib/signals/types';
import { logLeadEvent, updateLead } from '@/lib/signals/leads/store';
import { decideContactStatus } from '@/lib/signals/leads/identity';

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
 * Enrichment steps 2-4 are no-ops until their providers are wired with the
 * confirmed Apify actor id / query strings, so a lead with a scraped URL
 * resolves and one without lands in no_contact — enough to drive the UI today.
 */
export async function resolveLeadContacts(
  client: InsforgeClient,
  workspaceId: string,
  lead: SignalLeadWithContacts,
): Promise<ResolveResult> {
  const contacts = lead.contacts ?? [];
  const primary = contacts.find((c) => c.is_primary) ?? contacts[0] ?? null;

  // Step 1: scraped identifier (prefers CEO/Founder title — see decideContactStatus).
  const decision = decideContactStatus(contacts);
  if (decision.status === 'resolved' && decision.primaryIndex !== null) {
    await markPrimary(client, contacts[decision.primaryIndex]);
    await setStatus(client, workspaceId, lead.id, 'resolved', decision.via);
    return { status: 'resolved', via: decision.via };
  }

  // Steps 2-4: enrichment (gated). When a provider resolves a URL, upsert it
  // onto the contact row and mark resolved. Left as extension points here.
  const enriched = await tryEnrichment(client, workspaceId, lead, primary);
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
 * Enrichment cascade placeholder. Returns the provider name that resolved a
 * contact, or null. Wire Apify (primary) / TinyFish / Unipile search here once
 * the actor id + query strings are confirmed. Kept a no-op so the build + Today
 * tab work today; a lead without a scraped handle stays no_contact until then.
 */
async function tryEnrichment(
  _client: InsforgeClient,
  _workspaceId: string,
  _lead: SignalLeadWithContacts,
  _primary: SignalLeadContactRow | null,
): Promise<string | null> {
  return null;
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
