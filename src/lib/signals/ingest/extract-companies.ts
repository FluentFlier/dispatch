import type { IngestedLead, LeadSource } from '@/lib/signals/types';
import { chatCompletion } from '@/lib/llm';
import { normalizeDomain } from '@/lib/signals/leads/identity';
import { signalsDebugEnabled } from '@/lib/signals/ingest/config';
import type { DiscoveryContext } from '@/lib/signals/ingest/lead-sources/types';

/**
 * Shared company-extraction path: turn scraped text (search snippets and/or fetched
 * page content) into normalized leads via one LLM call. Used by web_discovery
 * (Search+Fetch, ICP-filtered) and the directory Fetch path (Product Hunt / YC
 * Launches, extract-all). Kept in its own module so both callers import it without
 * a web-discovery <-> tinyfish-fetch cycle.
 */

/** Hard cap on companies returned from a single extraction. */
export const MAX_EXTRACT = 20;
/** Cap per-page text handed to the extractor (keeps the LLM prompt bounded). */
export const MAX_PAGE_CHARS = 6000;

export interface ExtractedCompany {
  company_name?: string;
  website?: string;
  tagline?: string;
  tags?: string[];
}

const EXTRACT_SYSTEM = [
  'You extract companies or organizations that match an ideal-customer-profile (ICP) from web search results.',
  'Return ONLY valid JSON with this shape:',
  '{"companies":[{"company_name":"...","website":"https://...","tagline":"...","tags":["..."]}]}',
  'Include only real businesses that clearly fit the ICP. No duplicates. No invented names.',
  'If website is unknown, omit it or set null. Max 20 companies.',
].join(' ');

/**
 * Directory/launch-page variant: extract EVERY company/product on the page, not
 * only ICP matches. ICP relevance is scored downstream (scoreIcpFit), so filtering
 * here would starve a narrow-ICP workspace of directory leads entirely.
 */
const DIRECTORY_EXTRACT_SYSTEM = [
  'You extract the companies or products listed on a startup directory or launch page.',
  'Return ONLY valid JSON with this shape:',
  '{"companies":[{"company_name":"...","website":"https://...","tagline":"...","tags":["..."]}]}',
  'Include EVERY distinct real company/product visible in the content. No duplicates. No invented names.',
  'If website is unknown, omit it or set null. Max 20 companies.',
].join(' ');

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export function parseExtractedCompanies(raw: string): ExtractedCompany[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? raw).trim();
  try {
    const parsed = JSON.parse(candidate) as { companies?: unknown };
    if (!Array.isArray(parsed.companies)) return [];
    return parsed.companies as ExtractedCompany[];
  } catch {
    const match = raw.match(/\{[\s\S]*"companies"[\s\S]*\}/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[0]) as { companies?: unknown };
      return Array.isArray(parsed.companies) ? (parsed.companies as ExtractedCompany[]) : [];
    } catch {
      return [];
    }
  }
}

/** externalId prefix per source (`web` kept for web_discovery back-compat). */
function idPrefix(source: LeadSource): string {
  return source === 'web_discovery' ? 'web' : source;
}

export function mapExtractedToLeads(
  rows: ExtractedCompany[],
  source: LeadSource = 'web_discovery',
): IngestedLead[] {
  const seen = new Set<string>();
  const leads: IngestedLead[] = [];
  const prefix = idPrefix(source);

  for (const row of rows) {
    const companyName = String(row.company_name ?? '').trim();
    if (!companyName || companyName.length < 2) continue;
    const website = row.website ? String(row.website).trim() : undefined;
    const domain = website ? normalizeDomain(website) : undefined;
    const dedupeKey = domain ?? slugify(companyName);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    leads.push({
      source,
      externalId: `${prefix}-${slugify(companyName)}${domain ? `-${domain.replace(/\./g, '-')}` : ''}`,
      companyName,
      tagline: row.tagline ? String(row.tagline).trim() : undefined,
      website,
      tags: Array.isArray(row.tags) ? row.tags.map(String).filter(Boolean).slice(0, 8) : [],
      founders: [],
    });
  }
  return leads;
}

/**
 * Runs the extraction LLM call over the given text blocks and maps the result to
 * leads for `source`. `mode: 'icp'` filters to ICP fits (web_discovery search);
 * `mode: 'all'` extracts every listed company (directory pages). Returns [] on an
 * LLM error (logged in debug) - callers treat that as "found none".
 */
export async function extractCompanyLeads(
  ctx: DiscoveryContext,
  source: LeadSource,
  blocks: { serp?: string; pages?: string },
  opts: { mode?: 'icp' | 'all'; complete?: typeof chatCompletion } = {},
): Promise<IngestedLead[]> {
  const serp = blocks.serp?.trim();
  const pages = blocks.pages?.trim();
  if (!serp && !pages) return [];
  const mode = opts.mode ?? 'icp';
  const complete = opts.complete ?? chatCompletion;

  const header =
    mode === 'all'
      ? 'Extract every company/product listed in the content below.'
      : `ICP: ${ctx.icpDescription?.trim() || ctx.icpQuery}\n` +
        `Verticals: ${ctx.icpVerticals.join(', ') || 'n/a'}\n` +
        `Keywords: ${ctx.icpKeywords.join(', ') || 'n/a'}`;

  const userPrompt = [
    header,
    '',
    serp ? 'Search results:\n' + serp : '',
    pages ? '\nPage content:\n' + pages : '',
  ]
    .filter(Boolean)
    .join('\n');

  const system = mode === 'all' ? DIRECTORY_EXTRACT_SYSTEM : EXTRACT_SYSTEM;
  let raw: string;
  try {
    raw = await complete(system, userPrompt, { temperature: 0.1, maxTokens: 2000 });
  } catch (err) {
    if (signalsDebugEnabled()) {
      console.warn(
        `[extract-companies] LLM extract failed (${source}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return [];
  }

  const extracted = parseExtractedCompanies(raw);
  return mapExtractedToLeads(extracted, source).slice(0, Math.min(ctx.maxLeads, MAX_EXTRACT));
}
