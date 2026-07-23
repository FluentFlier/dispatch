import { chatCompletion } from '@/lib/llm';

/** Input for scoring a scraped directory company against the workspace ICP. */
export interface IcpFitInput {
  companyName: string;
  tagline?: string | null;
  tags?: string[];
  verticals: string[];
  keywords: string[];
  description?: string | null;
  contacts?: Array<{ role?: string | null }>;
}

const SYSTEM = [
  'You score how well a company AND its available contact match a sales team ideal-customer-profile (ICP).',
  'Honor person role and seniority constraints. If the ICP explicitly requests individual contributors, a founder/CEO-only contact is a poor fit even when the company topic matches.',
  'Reply with ONLY a decimal number between 0 and 1. No words. 1 = perfect fit, 0 = no fit.',
].join(' ');

/**
 * Scores a scraped directory company against the workspace ICP using the LLM.
 * Returns a neutral 0.5 (no LLM call) when the workspace has not configured any
 * ICP verticals or keywords, so ranking degrades gracefully instead of hiding
 * every lead. Fail-closed to 0.5 on any LLM error or unparseable output so a
 * flaky provider never blocks or corrupts lead ranking.
 */
export async function scoreIcpFit(input: IcpFitInput): Promise<number> {
  if (input.verticals.length === 0 && input.keywords.length === 0) return 0.5;

  const user = [
    `ICP description: ${input.description ?? 'none'}`,
    `ICP verticals: ${input.verticals.join(', ') || 'none'}`,
    `ICP keywords: ${input.keywords.join(', ') || 'none'}`,
    `Company: ${input.companyName}`,
    `Tagline: ${input.tagline ?? 'n/a'}`,
    `Tags: ${(input.tags ?? []).join(', ') || 'n/a'}`,
    `Available contact roles: ${(input.contacts ?? []).map((c) => c.role).filter(Boolean).join(', ') || 'none'}`,
  ].join('\n');

  let raw: string;
  try {
    raw = await chatCompletion(SYSTEM, user, { temperature: 0 });
  } catch {
    return 0.5;
  }
  // Capture an optional leading minus so a negative score clamps to 0, not 1.
  const n = Number.parseFloat(raw.trim().match(/-?[0-9]*\.?[0-9]+/)?.[0] ?? '');
  if (Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
