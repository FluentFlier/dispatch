import type { DirectorySettingsRow, IngestedLead } from '@/lib/signals/types';
import { icpToSearchQuery } from '@/lib/signals/icp/parse-description';
import { LEAD_OUTPUT_SCHEMA } from '@/lib/signals/ingest/directory-queries';
import { fetchYcCompaniesViaAlgolia } from '@/lib/signals/ingest/yc-algolia';
import { isTinyFishConfigured } from '@/lib/signals/ingest/tinyfish-fetch';
import { signalsDebugEnabled, scrapeTimeoutMs } from '@/lib/signals/ingest/config';

const AGENT_ENDPOINT = 'https://agent.tinyfish.ai/v1/automation/run';
const YC_COMPANIES_URL = 'https://www.ycombinator.com/companies';
const MAX_ICP_LEADS = 20;

interface AgentRunResponse {
  status?: string;
  result?: Record<string, unknown> | null;
  error?: string | null;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function normalizeAgentCompanies(result: Record<string, unknown>): IngestedLead[] {
  const listKey = Array.isArray(result.companies)
    ? 'companies'
    : Object.keys(result).find((k) => Array.isArray(result[k]));
  const rows = (listKey ? (result[listKey] as unknown[]) : []) as Array<Record<string, unknown>>;

  return rows
    .map((r): IngestedLead | null => {
      const companyName = String(r.company_name ?? '').trim();
      const externalId = String(r.external_id ?? slugify(companyName)).trim();
      if (!companyName || !externalId) return null;
      const foundersRaw = (r.founders ?? r.makers ?? []) as Array<Record<string, unknown>>;
      return {
        source: 'manual',
        externalId: `icp-${externalId}`,
        companyName,
        tagline: r.tagline ? String(r.tagline) : undefined,
        website: r.website ? String(r.website) : undefined,
        batch: r.batch ? String(r.batch) : undefined,
        tags: Array.isArray(r.tags) ? (r.tags as unknown[]).map(String) : [],
        founders: foundersRaw.map((f) => ({
          name: f.name ? String(f.name) : undefined,
          role: f.role ? String(f.role) : undefined,
          linkedinUrl: f.linkedin_url ? String(f.linkedin_url) : undefined,
          xHandle: f.x_handle ? String(f.x_handle) : undefined,
        })),
      };
    })
    .filter((l): l is IngestedLead => l !== null);
}

/**
 * BigSet-style ICP discovery: use structured ICP to pull matching companies.
 * 1) YC Algolia with an ICP query (fast, deterministic when configured).
 * 2) TinyFish agent with the NL discovery goal (broader web, when key is set).
 */
export async function fetchIcpDiscoveryLeads(
  settings: Pick<DirectorySettingsRow, 'icp_verticals' | 'icp_keywords' | 'icp_description'>,
): Promise<IngestedLead[]> {
  const query = icpToSearchQuery(
    settings.icp_verticals ?? [],
    settings.icp_keywords ?? [],
    settings.icp_description,
  );
  if (!query && !settings.icp_description?.trim()) return [];

  const debug = signalsDebugEnabled();
  const collected = new Map<string, IngestedLead>();

  // Fast path: YC Algolia filtered by ICP terms.
  if (query) {
    try {
      const yc = await fetchYcCompaniesViaAlgolia(MAX_ICP_LEADS, query);
      for (const lead of yc) collected.set(lead.externalId, lead);
      if (debug) console.log(`[icp-discovery] yc-algolia query="${query}" → ${yc.length}`);
    } catch (err) {
      if (debug) {
        console.warn(`[icp-discovery] yc-algolia failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Agent path: NL goal from ICP description (TinyFish / BigSet-style).
  const goal =
    settings.icp_description?.trim() ||
    `Find ${MAX_ICP_LEADS} startups matching: ${query}`;
  if (isTinyFishConfigured() && goal) {
    const agentGoal =
      `${goal}. Go to startup directories (Y Combinator company directory and/or Product Hunt). ` +
      `WAIT for listings to load, scroll to load more, then extract up to ${MAX_ICP_LEADS} ` +
      `matching companies from listing cards ONLY (do NOT open individual pages). ` +
      `For each: external_id (slug or id), company_name, tagline, website, batch, tags. Return JSON.`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), scrapeTimeoutMs());
    try {
      const res = await fetch(AGENT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.TINYFISH_API_KEY!.trim(),
        },
        body: JSON.stringify({
          url: YC_COMPANIES_URL,
          goal: agentGoal,
          output_schema: LEAD_OUTPUT_SCHEMA,
        }),
        signal: controller.signal,
      });
      if (res.ok) {
        const payload = (await res.json()) as AgentRunResponse;
        if (payload.status === 'COMPLETED' && payload.result) {
          for (const lead of normalizeAgentCompanies(payload.result)) {
            collected.set(lead.externalId, lead);
          }
          if (debug) console.log(`[icp-discovery] tinyfish agent → ${normalizeAgentCompanies(payload.result).length}`);
        }
      }
    } catch (err) {
      if (debug) {
        console.warn(`[icp-discovery] tinyfish failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return Array.from(collected.values()).slice(0, MAX_ICP_LEADS);
}
