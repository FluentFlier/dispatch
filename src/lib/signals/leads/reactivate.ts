import type { createClient } from '@insforge/sdk';
import {
  companiesMatch,
  hasHardIntent,
  intentFromSignalType,
  shouldResurface,
} from '@/lib/signals/leads/identity';
import { computeFitScore, computeRankScore } from '@/lib/signals/leads/score';
import {
  getDirectorySettings,
  listFollowedCompanies,
  listLeads,
  logLeadEvent,
  updateLead,
} from '@/lib/signals/leads/store';
import type { LeadIntentFlags } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

const LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;

export interface ReactivateResult {
  resurfaced: number;
  created: number;
}

interface RecentSignal {
  company_name: string | null;
  signal_type: string;
}

/**
 * Phase 8 reactivation: join recent post-watcher signal_events (funding/role/…)
 * to existing leads and to the followed-companies watchlist, and resurface per
 * shouldResurface. Matching is strict (companiesMatch, no fuzzy) so a renamed
 * company still matches on its stable anchor and look-alikes never cross-match.
 * A followed company with no lead yet gets a `manual` lead created on hard intent.
 */
export async function reactivateWorkspaceLeads(
  client: InsforgeClient,
  workspaceId: string,
  today: string,
  now: Date = new Date(),
): Promise<ReactivateResult> {
  const result: ReactivateResult = { resurfaced: 0, created: 0 };

  const sinceIso = new Date(now.getTime() - LOOKBACK_MS).toISOString();
  const { data: eventRows } = await client.database
    .from('signal_events')
    .select('company_name, signal_type')
    .eq('workspace_id', workspaceId)
    .gte('created_at', sinceIso)
    .limit(200);
  const signals = (eventRows ?? []) as RecentSignal[];
  if (signals.length === 0) return result;

  const [settings, leads, followed] = await Promise.all([
    getDirectorySettings(client, workspaceId),
    listLeads(client, workspaceId, { limit: 200 }),
    listFollowedCompanies(client, workspaceId),
  ]);

  for (const sig of signals) {
    if (!sig.company_name) continue;
    const sigKey = { companyName: sig.company_name };
    const flags = intentFromSignalType(sig.signal_type);

    const lead = leads.find((l) =>
      companiesMatch({ externalId: l.external_id, domain: l.domain, companyName: l.company_name }, sigKey),
    );
    const isFollowed = followed.some((f) =>
      companiesMatch({ domain: f.domain, companyName: f.company_name }, sigKey),
    );

    if (lead) {
      const merged: LeadIntentFlags = { ...lead.intent_flags, ...flags };
      const decision = shouldResurface({
        leadStatus: lead.lead_status,
        isFollowed,
        intentFlags: merged,
        gotIntentSignal: true,
      });
      if (!decision.resurface) continue;
      const fit = computeFitScore(lead, settings);
      const rank = computeRankScore({ intent_flags: merged, contact_status: lead.contact_status, digest_date: today }, fit, today);
      await updateLead(client, workspaceId, lead.id, {
        intent_flags: merged,
        rank_score: rank,
        digest_date: today,
        lead_status: 'resurfaced',
      });
      await logLeadEvent(client, workspaceId, lead.id, 'reactivated', {
        reason: decision.reason,
        signal_type: sig.signal_type,
      });
      result.resurfaced += 1;
      continue;
    }

    // No lead yet — a followed company on HARD intent gets a manual lead created.
    if (isFollowed && hasHardIntent(flags)) {
      const match = followed.find((f) =>
        companiesMatch({ domain: f.domain, companyName: f.company_name }, sigKey),
      );
      const { data: inserted } = await client.database
        .from('signal_leads')
        .insert([
          {
            workspace_id: workspaceId,
            source: 'manual',
            external_id: match?.external_id ?? null,
            company_name: sig.company_name,
            domain: match?.domain ?? null,
            intent_flags: flags,
            source_fact: { signal_type: sig.signal_type },
            lead_status: 'resurfaced',
            contact_status: 'unresolved',
            digest_date: today,
            rank_score: 1,
          },
        ])
        .select('id');
      const leadId = (inserted?.[0] as { id: string } | undefined)?.id;
      if (leadId) {
        await logLeadEvent(client, workspaceId, leadId, 'reactivated', {
          reason: 'followed + hard intent (created)',
          signal_type: sig.signal_type,
        });
        result.created += 1;
      }
    }
  }

  return result;
}
