import type { createClient } from '@insforge/sdk';
import { logLeadEvent } from '@/lib/signals/leads/store';
import { sendSlackAlert } from '@/lib/composio/actions/slack';
import { isComposioConfigured } from '@/lib/composio/config';
import { getIntegration } from '@/lib/signals/integrations/store';
import type { ClassifiedSignal, LeadIntentFlags, SignalType } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

/** Which intent flag a detected signal raises on the lead. */
const FLAG_FOR_SIGNAL: Partial<Record<SignalType, keyof LeadIntentFlags>> = {
  funding_round: 'raised',
  accelerator_join: 'accelerator_join',
  launch: 'launch',
  role_change: 'role_change',
  keyword_match: 'keyword_match',
};

/** Explicit column list on purpose - select('*') with .eq() filters is a known
 *  silent-empty quirk on this backend (see store.ts). */
const BRIDGE_COLS = 'id, company_name, domain, intent_flags, lead_status';

interface BridgeLeadRow {
  id: string;
  company_name: string;
  domain: string | null;
  intent_flags: LeadIntentFlags | null;
  lead_status: string;
}

export interface SignalBridgeResult {
  /** Existing leads that got the signal stamped. */
  matched: number;
  /** Watchlist leads created because the watched company had no lead row. */
  created: number;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

/**
 * The port of the retired Signals feature: a detected signal lands ON THE LEAD
 * instead of in a separate events feed. Matches workspace leads by company
 * name or domain, creates a lead when a watched (followed) company has no row
 * yet, raises the matching intent flag + last-signal fields (which the feed
 * card surfaces), resurfaces dismissed leads, logs to the lead event trail,
 * and fires the Slack alert the old feature had. Best-effort by design: a
 * failure here must never break the ingest poll that called it.
 */
export async function applySignalToLeads(
  client: InsforgeClient,
  workspaceId: string,
  classified: ClassifiedSignal,
  opts: { sourceUrl?: string } = {},
): Promise<SignalBridgeResult> {
  const result: SignalBridgeResult = { matched: 0, created: 0 };
  const company = classified.companyName?.trim();
  if (!company) return result;
  const lower = company.toLowerCase();

  const { data, error } = await client.database
    .from('signal_leads')
    .select(BRIDGE_COLS)
    .eq('workspace_id', workspaceId)
    .limit(500);
  if (error) return result;

  let targets = ((data ?? []) as unknown as BridgeLeadRow[]).filter(
    (l) => l.company_name?.trim().toLowerCase() === lower,
  );

  if (targets.length === 0) {
    // A watched company without a lead row gets one, so the signal has a home.
    const { data: followed } = await client.database
      .from('signal_followed_companies')
      .select('company_name, domain')
      .eq('workspace_id', workspaceId)
      .limit(200);
    const watch = (followed ?? []).find(
      (f) => String(f.company_name ?? '').trim().toLowerCase() === lower,
    );
    if (!watch) return result;

    const nowIso = new Date().toISOString();
    const { data: inserted, error: insErr } = await client.database
      .from('signal_leads')
      .insert([
        {
          workspace_id: workspaceId,
          source: 'manual',
          external_id: `watch-${slugify(company)}`,
          company_name: company,
          domain: (watch.domain as string | null) ?? null,
          tags: [],
          intent_flags: {},
          source_fact: opts.sourceUrl ? { source_url: opts.sourceUrl } : {},
          name_history: [],
          lead_status: 'new',
          digest_date: nowIso.slice(0, 10),
          first_seen_at: nowIso,
          last_seen_at: nowIso,
        },
      ])
      .select('id');
    const id = (inserted?.[0] as { id: string } | undefined)?.id;
    if (insErr || !id) return result;
    result.created = 1;
    targets = [
      { id, company_name: company, domain: (watch.domain as string | null) ?? null, intent_flags: {}, lead_status: 'new' },
    ];
  }

  const flag = FLAG_FOR_SIGNAL[classified.signalType];
  const nowIso = new Date().toISOString();
  for (const lead of targets) {
    const flags: LeadIntentFlags = {
      ...(lead.intent_flags ?? {}),
      ...(flag ? { [flag]: true } : {}),
      last_signal_type: classified.signalType,
      last_signal_summary: classified.signalSummary?.slice(0, 300),
      last_signal_at: nowIso,
    };
    const { error: updErr } = await client.database
      .from('signal_leads')
      .update({
        intent_flags: flags,
        last_seen_at: nowIso,
        // A fresh buying signal brings a dismissed lead back to the surface.
        ...(lead.lead_status === 'dismissed' ? { lead_status: 'resurfaced' } : {}),
      })
      .eq('id', lead.id);
    if (updErr) continue;
    await logLeadEvent(client, workspaceId, lead.id, 'rescored', {
      action: 'signal',
      signal_type: classified.signalType,
      summary: classified.signalSummary,
    });
    result.matched += 1;
  }

  if (result.matched + result.created > 0) {
    await notifySlackForLeadSignal(client, workspaceId, classified).catch(() => {});
  }
  return result;
}

/** Slack alert for a signal that landed on a lead (port of the old alert). */
async function notifySlackForLeadSignal(
  client: InsforgeClient,
  workspaceId: string,
  classified: ClassifiedSignal,
): Promise<void> {
  if (!isComposioConfigured()) return;
  const integration = await getIntegration(client, workspaceId, 'slack');
  if (!integration?.enabled) return;
  const channelId = integration.config.slack_channel_id;
  if (!channelId || integration.config.notify_on_new_signal === false) return;

  await sendSlackAlert(integration.composio_user_id, {
    channelId,
    title: `New ${classified.signalType.replace(/_/g, ' ')} signal`,
    summary: classified.signalSummary ?? 'Review this lead in Content OS.',
    company: classified.companyName,
    batch: classified.batch,
    signalUrl: `${appBaseUrl()}/leads`,
  });
}
