import type { createClient } from '@insforge/sdk';
import { parseImportFileBuffer } from '@/lib/signals/leads/import-parse';
import { mapImportRowsToLeads } from '@/lib/signals/leads/import-map';
import { extractLeadsFromText } from '@/lib/signals/leads/import-extract';
import {
  getDirectorySettings,
  getLead,
  logLeadEvent,
  updateLead,
  upsertIngestedLeads,
} from '@/lib/signals/leads/store';
import { resolveLeadContacts } from '@/lib/signals/leads/resolve-contact';
import { computeFitScore, computeRankScore } from '@/lib/signals/leads/score';
import { scoreIcpFit } from '@/lib/signals/leads/icp-score';
import { checkAndIncrementUsage } from '@/lib/ai-budget';
import { signalsEnrichInlineEnabled } from '@/lib/signals/ingest/config';
import { mapWithConcurrency } from '@/lib/util/concurrency';
import type { IngestedLead } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_LEADS = 200;
const MAX_BATCH_RESOLVE = 40;
const ICP_CONCURRENCY = 5;

export interface LeadImportResult {
  parsed: number;
  inserted: number;
  updated: number;
  resolved: number;
  noContact: number;
  skipped: number;
  warnings: string[];
  leadIds: string[];
}

export async function importLeadsFromFile(
  client: InsforgeClient,
  workspaceId: string,
  file: { buffer: Buffer; filename: string; mimeType?: string },
  opts: { resolveContacts?: boolean } = {},
): Promise<LeadImportResult> {
  const result: LeadImportResult = {
    parsed: 0,
    inserted: 0,
    updated: 0,
    resolved: 0,
    noContact: 0,
    skipped: 0,
    warnings: [],
    leadIds: [],
  };

  const parsed = await parseImportFileBuffer(file.buffer, file.filename, file.mimeType);
  let leads: IngestedLead[] = mapImportRowsToLeads(parsed.rows);

  if (leads.length === 0 && parsed.rawText.trim()) {
    const extracted = await extractLeadsFromText(parsed.rawText);
    leads = extracted;
    if (extracted.length === 0 && parsed.kind === 'pdf') {
      result.warnings.push('Could not extract leads from PDF - try CSV or XLSX, or ensure LLM is configured.');
    }
  }

  result.parsed = leads.length;
  if (leads.length === 0) {
    result.warnings.push('No leads found. Use columns like company_name, name, linkedin_url, email.');
    return result;
  }

  if (leads.length > MAX_IMPORT_LEADS) {
    result.warnings.push(`Capped import at ${MAX_IMPORT_LEADS} leads (${leads.length} in file).`);
    leads = leads.slice(0, MAX_IMPORT_LEADS);
  }

  const today = new Date().toISOString().slice(0, 10);
  const upsert = await upsertIngestedLeads(client, workspaceId, leads, today);
  result.inserted = upsert.inserted;
  result.updated = upsert.updated;
  result.leadIds = upsert.leadIds;
  result.skipped = leads.length - upsert.leadIds.length;

  for (const leadId of upsert.leadIds) {
    await logLeadEvent(client, workspaceId, leadId, 'new', { source: 'file_import', filename: file.filename });
  }

  if (opts.resolveContacts !== false) {
    await finalizeImportedLeads(client, workspaceId, upsert.leadIds, result);
  }

  return result;
}

async function finalizeImportedLeads(
  client: InsforgeClient,
  workspaceId: string,
  leadIds: string[],
  result: LeadImportResult,
): Promise<void> {
  const settings = await getDirectorySettings(client, workspaceId);
  const today = new Date().toISOString().slice(0, 10);
  const fastOnly = !signalsEnrichInlineEnabled();
  const resolveIds = leadIds.slice(0, MAX_BATCH_RESOLVE);

  const leads = (
    await Promise.all(resolveIds.map((id) => getLead(client, workspaceId, id)))
  ).filter((l): l is NonNullable<typeof l> => l !== null);

  for (const lead of leads) {
    if (lead.contact_status === 'resolved') {
      result.resolved += 1;
      continue;
    }
    const res = await resolveLeadContacts(client, workspaceId, lead, { enrich: true, fastOnly });
    if (res.status === 'resolved') result.resolved += 1;
    if (res.status === 'no_contact') result.noContact += 1;
  }

  const icpConfigured =
    (settings.icp_verticals?.length ?? 0) > 0 ||
    (settings.icp_keywords?.length ?? 0) > 0 ||
    Boolean(settings.icp_description?.trim());

  const icpFits = await mapWithConcurrency(leads, ICP_CONCURRENCY, async (lead) => {
    if (!icpConfigured) return 0.5;
    const budget = await checkAndIncrementUsage(client, workspaceId, 'haiku');
    if (budget === 'blocked') return 0.5;
    return scoreIcpFit({
      companyName: lead.company_name,
      tagline: lead.tagline,
      tags: lead.tags,
      verticals: settings.icp_verticals,
      keywords: settings.icp_keywords,
    });
  });

  for (let i = 0; i < leads.length; i += 1) {
    const lead = leads[i];
    const fit = computeFitScore(lead, settings);
    const blendedFit = Number((0.7 * icpFits[i] + 0.3 * fit).toFixed(3));
    const rank = computeRankScore(lead, blendedFit, today);
    await updateLead(client, workspaceId, lead.id, { fit_score: blendedFit, rank_score: rank });
  }
}
