import type { createClient } from '@insforge/sdk';

type InsforgeClient = ReturnType<typeof createClient>;

export interface ContactIdentity {
  linkedinProviderId?: string;
  linkedinUrl?: string;
  xHandle?: string;
  email?: string;
}

export interface PriorContactResult {
  contacted: boolean;
  blockedByDnc: boolean;
  lastAt?: string;
  channel?: string;
  leadId?: string;
}

interface SignalLeadContactMatchRow {
  id: string;
  lead_id: string;
  provider_id: string | null;
  linkedin_url: string | null;
  x_handle: string | null;
  email: string | null;
}

interface SignalOutreachSentRow {
  id: string;
  lead_id: string;
  channel: string;
  status: string;
  created_at: string;
  sent_at?: string;
}

/** One normalized identity field, ready to match against do_not_contact / signal_lead_contacts. */
interface IdentityField {
  dncColumn: 'linkedin_provider_id' | 'linkedin_url' | 'x_handle' | 'email';
  contactColumn: 'provider_id' | 'linkedin_url' | 'x_handle' | 'email';
  value: string;
  /** email/x_handle: stored casing may vary, so match case-insensitively. */
  caseInsensitive: boolean;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

/** Builds the non-empty, normalized identity fields to query on (max 4). */
function buildIdentityFields(identity: ContactIdentity): IdentityField[] {
  const fields: IdentityField[] = [];
  const providerId = identity.linkedinProviderId?.trim();
  if (providerId) {
    fields.push({
      dncColumn: 'linkedin_provider_id',
      contactColumn: 'provider_id',
      value: providerId,
      caseInsensitive: false,
    });
  }
  const linkedinUrl = identity.linkedinUrl?.trim();
  if (linkedinUrl) {
    fields.push({
      dncColumn: 'linkedin_url',
      contactColumn: 'linkedin_url',
      value: stripTrailingSlash(linkedinUrl),
      caseInsensitive: false,
    });
  }
  const xHandle = identity.xHandle?.trim();
  if (xHandle) {
    fields.push({ dncColumn: 'x_handle', contactColumn: 'x_handle', value: xHandle.toLowerCase(), caseInsensitive: true });
  }
  const email = identity.email?.trim();
  if (email) {
    fields.push({ dncColumn: 'email', contactColumn: 'email', value: email.toLowerCase(), caseInsensitive: true });
  }
  return fields;
}

/** Do-not-contact lookup, one field at a time, stopping at the first hit. */
async function isBlockedByDnc(
  client: InsforgeClient,
  workspaceId: string,
  fields: IdentityField[],
): Promise<boolean> {
  for (const field of fields) {
    const base = client.database.from('do_not_contact').select('id').eq('workspace_id', workspaceId);
    const filtered = field.caseInsensitive ? base.ilike(field.dncColumn, field.value) : base.eq(field.dncColumn, field.value);
    const { data } = await filtered.limit(1);
    if (data && data.length > 0) return true;
  }
  return false;
}

/** Collects every distinct lead_id whose contact row matches any identity field. */
async function findMatchingLeadIds(
  client: InsforgeClient,
  workspaceId: string,
  fields: IdentityField[],
): Promise<string[]> {
  const leadIds = new Set<string>();
  for (const field of fields) {
    const base = client.database
      .from('signal_lead_contacts')
      .select('id, lead_id, provider_id, linkedin_url, x_handle, email')
      .eq('workspace_id', workspaceId);
    const filtered = field.caseInsensitive
      ? base.ilike(field.contactColumn, field.value)
      : base.eq(field.contactColumn, field.value);
    const { data } = await filtered;
    for (const row of (data ?? []) as SignalLeadContactMatchRow[]) {
      if (row.lead_id) leadIds.add(row.lead_id);
    }
  }
  return Array.from(leadIds);
}

/** Newest 'sent' outreach row across the matched leads, or null if none was ever sent. */
async function findLatestSentOutreach(
  client: InsforgeClient,
  workspaceId: string,
  leadIds: string[],
): Promise<SignalOutreachSentRow | null> {
  const { data } = await client.database
    .from('signal_outreach')
    .select('id, lead_id, channel, status, created_at, sent_at')
    .eq('workspace_id', workspaceId)
    .in('lead_id', leadIds)
    .eq('status', 'sent')
    .order('sent_at', { ascending: false })
    .limit(1);
  const rows = (data ?? []) as SignalOutreachSentRow[];
  return rows[0] ?? null;
}

/**
 * Duplicate/do-not-contact lookup for outreach (Task 9). Matches the supplied
 * identity (LinkedIn provider id, LinkedIn URL, X handle, or email) against the
 * workspace do-not-contact list and any lead contact that already received a
 * sent outreach, so sendLeadOutreach (Task 10) can warn or block before
 * re-contacting the same person. An empty identity is never treated as a
 * match - no fields to compare means zero DB calls and a clean result.
 */
export async function checkPriorContact(
  client: InsforgeClient,
  workspaceId: string,
  identity: ContactIdentity,
): Promise<PriorContactResult> {
  const fields = buildIdentityFields(identity);
  if (fields.length === 0) return { contacted: false, blockedByDnc: false };

  const blockedByDnc = await isBlockedByDnc(client, workspaceId, fields);

  const leadIds = await findMatchingLeadIds(client, workspaceId, fields);
  if (leadIds.length === 0) return { contacted: false, blockedByDnc };

  const sent = await findLatestSentOutreach(client, workspaceId, leadIds);
  if (!sent) return { contacted: false, blockedByDnc };

  return {
    contacted: true,
    blockedByDnc,
    lastAt: sent.sent_at ?? sent.created_at,
    channel: sent.channel,
    leadId: sent.lead_id,
  };
}
