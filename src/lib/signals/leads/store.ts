import type { createClient } from '@insforge/sdk';
import { classifyLeadChange, normalizeDomain } from '@/lib/signals/leads/identity';
import type {
  DirectorySettingsRow,
  FollowedCompanyRow,
  IngestedLead,
  LeadEventType,
  LeadStatus,
  SignalLeadContactRow,
  SignalLeadRow,
  SignalLeadWithContacts,
} from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

// Re-exported for callers that import the anchor helper from the store.
export { normalizeDomain };

const DEFAULT_SETTINGS: Omit<DirectorySettingsRow, 'workspace_id' | 'created_at' | 'updated_at'> = {
  enabled_sources: ['yc_directory'],
  icp_description: null,
  icp_verticals: [],
  icp_keywords: [],
  recency_window: 'current_batch',
  digest_run_hour_local: 6,
  digest_timezone: null,
  digest_channels: { today: true, slack: false, email: false },
  digest_top_n: 15,
  sender_identity: null,
  digest_delivered_at: null,
};

// --- Settings ---

/**
 * Loads directory settings for a workspace, creating the row with conservative
 * defaults on first access. Directory config is intentionally separate from
 * signal_safety_settings (different lifecycle) — see the plan §3.2.
 */
export async function getDirectorySettings(
  client: InsforgeClient,
  workspaceId: string,
): Promise<DirectorySettingsRow> {
  const { data } = await client.database
    .from('signal_directory_settings')
    .select('*')
    .eq('workspace_id', workspaceId)
    .limit(1);

  if (data && data.length > 0) return data[0] as DirectorySettingsRow;

  const seed = { workspace_id: workspaceId, ...DEFAULT_SETTINGS };
  const { error } = await client.database.from('signal_directory_settings').insert([seed]);
  if (error) throw error;
  return seed as DirectorySettingsRow;
}

/** Persists directory/ICP/digest settings (partial patch). */
export async function updateDirectorySettings(
  client: InsforgeClient,
  workspaceId: string,
  patch: Partial<Omit<DirectorySettingsRow, 'workspace_id' | 'created_at' | 'updated_at'>>,
): Promise<void> {
  await getDirectorySettings(client, workspaceId); // ensure row exists
  const { error } = await client.database
    .from('signal_directory_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId);
  if (error) throw error;
}

// --- Leads ---

/**
 * Lists leads for the Today surface, newest/highest-ranked first, with the
 * primary contact and any outreach draft attached. Filters by lead_status.
 */
export async function listLeads(
  client: InsforgeClient,
  workspaceId: string,
  opts: { status?: LeadStatus; limit?: number } = {},
): Promise<SignalLeadWithContacts[]> {
  const limit = Math.min(opts.limit ?? 100, 200);
  // NOTE: do NOT chain .order() here. On this backend, select('*') + embedded
  // resources + .order() together collapse the result to a single row (each
  // alone is fine) — which silently hid all but one lead from the UI. We sort by
  // rank_score in JS instead (the leads UI also re-sorts client-side).
  let query = client.database
    .from('signal_leads')
    .select(`
      *,
      contacts:signal_lead_contacts(*),
      outreach:signal_outreach(*)
    `)
    .eq('workspace_id', workspaceId)
    .limit(limit);

  if (opts.status) query = query.eq('lead_status', opts.status);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? [])
    .map((row) => hydrateLead(row))
    .sort((a, b) => b.rank_score - a.rank_score);
}

/** Fetches a single lead with contacts + outreach. */
export async function getLead(
  client: InsforgeClient,
  workspaceId: string,
  leadId: string,
): Promise<SignalLeadWithContacts | null> {
  const { data, error } = await client.database
    .from('signal_leads')
    .select(`
      *,
      contacts:signal_lead_contacts(*),
      outreach:signal_outreach(*)
    `)
    .eq('workspace_id', workspaceId)
    .eq('id', leadId)
    .limit(1);

  if (error) throw error;
  if (!data || data.length === 0) return null;
  return hydrateLead(data[0]);
}

/** Attaches primary_contact + single outreach from the nested arrays. */
function hydrateLead(row: Record<string, unknown>): SignalLeadWithContacts {
  const contacts = (row.contacts as SignalLeadContactRow[] | undefined) ?? [];
  const outreachArr = row.outreach as unknown[];
  return {
    ...(row as unknown as SignalLeadRow),
    contacts,
    primary_contact: contacts.find((c) => c.is_primary) ?? contacts[0] ?? null,
    outreach: Array.isArray(outreachArr)
      ? (outreachArr[0] as SignalLeadWithContacts['outreach'])
      : (row.outreach as SignalLeadWithContacts['outreach']),
  };
}

export interface UpsertLeadsResult {
  inserted: number;
  updated: number;
  renamed: number;
}

/**
 * Idempotently upserts scraped leads, deduped on the stable anchor
 * (source + external_id). New anchors insert as `new` with today's digest_date.
 * A known anchor with a changed company_name is auto-reconciled (rename): the
 * name updates, the old name is appended to name_history, and a `renamed` event
 * is logged — so a follow/lead survives a rename without manual re-keying.
 */
export async function upsertIngestedLeads(
  client: InsforgeClient,
  workspaceId: string,
  leads: IngestedLead[],
  digestDate: string,
): Promise<UpsertLeadsResult> {
  const result: UpsertLeadsResult = { inserted: 0, updated: 0, renamed: 0 };

  // Explicit column list, NOT select('*'): on this backend, select('*') with
  // several .eq() filters + .limit(1) silently returns 0 rows (no error), which
  // made this existence check miss every existing lead and re-insert it —
  // crashing a re-scrape on the source+external_id unique constraint.
  const anchorCols = 'id, source, external_id, company_name, tagline, tags, domain, name_history';

  for (const lead of leads) {
    const { data: existingRows, error: existErr } = await client.database
      .from('signal_leads')
      .select(anchorCols)
      .eq('workspace_id', workspaceId)
      .eq('source', lead.source)
      .eq('external_id', lead.externalId)
      .limit(1);
    if (existErr) throw existErr;

    let existing = (existingRows?.[0] as SignalLeadRow | undefined) ?? null;
    const nowIso = new Date().toISOString();
    const domain = normalizeDomain(lead.website);

    // Cross-source dedupe (Phase 9): the same company can appear on YC and PH.
    // Match on the shared domain anchor and fold contacts into the one lead
    // instead of creating a duplicate row.
    if (!existing && domain) {
      const { data: domainRows, error: domainErr } = await client.database
        .from('signal_leads')
        .select(anchorCols)
        .eq('workspace_id', workspaceId)
        .eq('domain', domain)
        .limit(1);
      if (domainErr) throw domainErr;
      const domainMatch = (domainRows?.[0] as SignalLeadRow | undefined) ?? null;
      if (domainMatch) {
        await insertContactsForLead(client, workspaceId, domainMatch.id, lead);
        await logLeadEvent(client, workspaceId, domainMatch.id, 'merged', {
          from_source: lead.source,
          into: domainMatch.source,
        });
        existing = domainMatch;
      }
    }

    if (!existing) {
      const { data: inserted, error } = await client.database
        .from('signal_leads')
        .insert([
          {
            workspace_id: workspaceId,
            source: lead.source,
            external_id: lead.externalId,
            company_name: lead.companyName,
            tagline: lead.tagline ?? null,
            website: lead.website ?? null,
            domain,
            batch: lead.batch ?? null,
            tags: lead.tags ?? [],
            intent_flags: lead.intentFlags ?? {},
            source_fact: { batch: lead.batch, tagline: lead.tagline },
            // Seed rich company facts from the scrape (description + industries).
            // Completed once from the YC detail page at first draft, then reused.
            company_detail: {
              description: lead.longDescription,
              industries: lead.tags?.length ? lead.tags : undefined,
            },
            lead_status: 'new',
            digest_date: digestDate,
            first_seen_at: nowIso,
            last_seen_at: nowIso,
          },
        ])
        .select('id');
      if (error) throw error;
      const leadId = (inserted?.[0] as { id: string } | undefined)?.id;
      if (leadId) {
        await insertContactsForLead(client, workspaceId, leadId, lead);
        await logLeadEvent(client, workspaceId, leadId, 'new', { source: lead.source });
      }
      result.inserted += 1;
      continue;
    }

    // Known anchor — classify the change (rename auto-reconciles, pivot re-scores).
    const change = classifyLeadChange(existing, {
      companyName: lead.companyName,
      tags: lead.tags,
      tagline: lead.tagline,
    });
    const patch: Record<string, unknown> = { last_seen_at: nowIso };
    if (change.kind === 'renamed') {
      patch.company_name = lead.companyName;
      patch.name_history = [...(existing.name_history ?? []), change.nameHistoryAdd ?? existing.company_name];
      result.renamed += 1;
      await logLeadEvent(client, workspaceId, existing.id, 'renamed', {
        from: existing.company_name,
        to: lead.companyName,
      });
    } else if (change.kind === 'pivoted') {
      patch.tags = lead.tags ?? existing.tags;
      patch.tagline = lead.tagline ?? existing.tagline;
      await logLeadEvent(client, workspaceId, existing.id, 'pivoted', {
        tags: lead.tags,
        tagline: lead.tagline,
      });
    } else {
      await logLeadEvent(client, workspaceId, existing.id, 'scraped', {});
    }
    const { error: updErr } = await client.database
      .from('signal_leads')
      .update(patch)
      .eq('id', existing.id);
    if (updErr) throw updErr;
    result.updated += 1;
  }

  return result;
}

/** Inserts scraped founder contacts (best-effort, marks the first as primary). */
async function insertContactsForLead(
  client: InsforgeClient,
  workspaceId: string,
  leadId: string,
  lead: IngestedLead,
): Promise<void> {
  const founders = lead.founders ?? [];
  if (founders.length === 0) return;
  const rows = founders.map((f, i) => ({
    lead_id: leadId,
    workspace_id: workspaceId,
    name: f.name ?? null,
    role: f.role ?? null,
    linkedin_url: f.linkedinUrl ?? null,
    x_handle: f.xHandle ?? null,
    email: f.email ?? null,
    resolution_source: 'scraped' as const,
    is_primary: i === 0,
  }));
  const { error } = await client.database.from('signal_lead_contacts').insert(rows);
  if (error) throw error;
}

/** Patches a lead row (status transitions, scores, contact_status, etc.). */
export async function updateLead(
  client: InsforgeClient,
  workspaceId: string,
  leadId: string,
  patch: Partial<SignalLeadRow>,
): Promise<void> {
  const { error } = await client.database
    .from('signal_leads')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('id', leadId);
  if (error) throw error;
}

// --- Lead events (audit) ---

/** Appends a lead lifecycle event (scrape/score/rename/reactivation). */
export async function logLeadEvent(
  client: InsforgeClient,
  workspaceId: string,
  leadId: string | null,
  eventType: LeadEventType,
  detail: Record<string, unknown>,
): Promise<void> {
  const { error } = await client.database.from('signal_lead_events').insert([
    { workspace_id: workspaceId, lead_id: leadId, event_type: eventType, detail },
  ]);
  if (error) throw error;
}

// --- Followed companies (watchlist) ---

/** Lists the workspace watchlist (companies pinned for reactivation). */
export async function listFollowedCompanies(
  client: InsforgeClient,
  workspaceId: string,
): Promise<FollowedCompanyRow[]> {
  const { data, error } = await client.database
    .from('signal_followed_companies')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as FollowedCompanyRow[];
}

/** Adds a company to the watchlist (idempotent on the domain/name anchor). */
export async function addFollowedCompany(
  client: InsforgeClient,
  workspaceId: string,
  input: { companyName: string; domain?: string | null; externalId?: string | null; userId?: string },
): Promise<{ ok: boolean; duplicate?: boolean }> {
  const domain = normalizeDomain(input.domain) ?? input.domain ?? null;
  const { error } = await client.database.from('signal_followed_companies').insert([
    {
      workspace_id: workspaceId,
      company_name: input.companyName,
      domain,
      external_id: input.externalId ?? null,
      added_by_user_id: input.userId ?? null,
    },
  ]);
  if (error) {
    // Unique-violation → already following (not a hard failure).
    const code = (error as { code?: string }).code;
    if (code === '23505') return { ok: false, duplicate: true };
    throw error;
  }
  return { ok: true };
}

/** Removes a company from the watchlist. */
export async function removeFollowedCompany(
  client: InsforgeClient,
  workspaceId: string,
  id: string,
): Promise<void> {
  const { error } = await client.database
    .from('signal_followed_companies')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', id);
  if (error) throw error;
}
