import { chatCompletion } from '@/lib/llm';

/** Structured ICP parsed from a natural-language description. */
export interface ParsedIcp {
  icp_verticals: string[];
  icp_keywords: string[];
  gtm: {
    icp: string;
    pitch: string;
    objections: string;
    proof_points: string;
    cta_style: string;
  };
  /** Natural-language goal handed to the TinyFish agent for ICP-driven discovery. */
  discovery_goal: string;
}

const SYSTEM = [
  'You parse a founder GTM ideal-customer-profile (ICP) description into structured fields.',
  'Reply with ONLY valid JSON matching this shape:',
  '{',
  '  "icp_verticals": string[],',
  '  "icp_keywords": string[],',
  '  "gtm": {',
  '    "icp": string,',
  '    "pitch": string,',
  '    "objections": string,',
  '    "proof_points": string,',
  '    "cta_style": string',
  '  },',
  '  "discovery_goal": string',
  '}',
  'icp_verticals: 3-8 industry/segment labels (e.g. Fintech, B2B SaaS).',
  'icp_keywords: 5-12 topical keywords for matching (e.g. treasury, seed round, YC).',
  'gtm.icp: one paragraph summarizing who to sell to.',
  'gtm.pitch: one paragraph value prop for outreach.',
  'gtm.objections: common objections + rebuttals, semicolon-separated.',
  'gtm.proof_points: credibility bullets, semicolon-separated.',
  'gtm.cta_style: how to ask (soft, specific, never generic).',
  'discovery_goal: a single English sentence telling a web agent which companies to find',
  '(stage, vertical, geography, signals like hiring or funding). Be specific.',
].join(' ');

function extractJson(raw: string): ParsedIcp | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  try {
    const parsed = JSON.parse(candidate) as Partial<ParsedIcp>;
    if (!parsed.gtm || typeof parsed.discovery_goal !== 'string') return null;
    return {
      icp_verticals: Array.isArray(parsed.icp_verticals)
        ? parsed.icp_verticals.map(String).filter(Boolean).slice(0, 12)
        : [],
      icp_keywords: Array.isArray(parsed.icp_keywords)
        ? parsed.icp_keywords.map(String).filter(Boolean).slice(0, 20)
        : [],
      gtm: {
        icp: String(parsed.gtm.icp ?? '').trim(),
        pitch: String(parsed.gtm.pitch ?? '').trim(),
        objections: String(parsed.gtm.objections ?? '').trim(),
        proof_points: String(parsed.gtm.proof_points ?? '').trim(),
        cta_style: String(parsed.gtm.cta_style ?? '').trim(),
      },
      discovery_goal: parsed.discovery_goal.trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Parses a natural-language ICP into directory settings fields, a GTM playbook,
 * and a TinyFish discovery goal (BigSet-style: describe once → structured hunt).
 */
export async function parseIcpDescription(description: string): Promise<ParsedIcp> {
  const prose = description.trim();
  if (!prose) {
    throw new Error('ICP description is required.');
  }

  const raw = await chatCompletion(SYSTEM, prose, { temperature: 0.2, maxTokens: 1200 });
  const parsed = extractJson(raw);
  if (parsed) return parsed;

  // Deterministic fallback when the LLM returns non-JSON.
  const words = prose.split(/\s+/).filter((w) => w.length > 3).slice(0, 8);
  return {
    icp_verticals: words.slice(0, 4),
    icp_keywords: words,
    gtm: {
      icp: prose,
      pitch: '',
      objections: '',
      proof_points: '',
      cta_style: 'Soft ask tied to their recent news — never generic.',
    },
    discovery_goal: `Find startups matching: ${prose.slice(0, 280)}`,
  };
}

/** Builds an Algolia/search query string from structured ICP fields. */
export function icpToSearchQuery(
  verticals: string[],
  keywords: string[],
  description?: string | null,
): string {
  const parts = [...verticals, ...keywords];
  if (parts.length > 0) return parts.join(' ');
  return description?.trim().slice(0, 120) ?? '';
}
