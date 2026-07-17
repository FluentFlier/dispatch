import type { createClient } from '@insforge/sdk';
import { companiesMatch, shouldResurface } from '@/lib/signals/leads/identity';
import { computeFitScore, computeRankScore } from '@/lib/signals/leads/score';
import {
  getDirectorySettings,
  listFollowedCompanies,
  listLeads,
  logLeadEvent,
  updateLead,
} from '@/lib/signals/leads/store';

type InsforgeClient = ReturnType<typeof createClient>;

const LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;

export interface ReactivateResult {
  resurfaced: number;
  created: number;
}

/**
 * Daily reactivation sweep. Signals land on leads in real time via the intent
 * bridge (intent_flags.last_signal_* stamped, dismissed leads flipped to
 * resurfaced, watched companies get a lead created) - so this sweep no longer
 * reads the retired signal_events table. What it still owns is the DIGEST
 * surface: a lead with a fresh signal gets today's digest_date and a rank
 * re-score so it actually shows up at the top of the morning list, per the
 * shouldResurface policy.
 */
export async function reactivateWorkspaceLeads(
  client: InsforgeClient,
  workspaceId: string,
  today: string,
  now: Date = new Date(),
): Promise<ReactivateResult> {
  const result: ReactivateResult = { resurfaced: 0, created: 0 };
  const since = now.getTime() - LOOKBACK_MS;

  const [settings, leads, followed] = await Promise.all([
    getDirectorySettings(client, workspaceId),
    listLeads(client, workspaceId, { limit: 200 }),
    listFollowedCompanies(client, workspaceId),
  ]);

  const withFreshSignal = leads.filter((l) => {
    const at = l.intent_flags?.last_signal_at;
    return at && Date.parse(at) >= since && l.digest_date !== today;
  });

  for (const lead of withFreshSignal) {
    const isFollowed = followed.some((f) =>
      companiesMatch(
        { domain: f.domain, companyName: f.company_name },
        { companyName: lead.company_name },
      ),
    );
    const decision = shouldResurface({
      leadStatus: lead.lead_status,
      isFollowed,
      intentFlags: lead.intent_flags,
      gotIntentSignal: true,
    });
    if (!decision.resurface) continue;

    const fit = computeFitScore(lead, settings);
    const rank = computeRankScore(
      { intent_flags: lead.intent_flags, contact_status: lead.contact_status, digest_date: today },
      fit,
      today,
    );
    await updateLead(client, workspaceId, lead.id, {
      rank_score: rank,
      digest_date: today,
      lead_status: 'resurfaced',
    });
    await logLeadEvent(client, workspaceId, lead.id, 'reactivated', {
      reason: decision.reason,
      signal_type: lead.intent_flags?.last_signal_type,
    });
    result.resurfaced += 1;
  }

  return result;
}
