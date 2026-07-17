import type { SignalLeadWithContacts } from '@/lib/signals/types';
import { tinyfishSearch, tinyfishFetch } from '@/lib/signals/ingest/tinyfish-web';
import { leadSourceUrl } from '@/lib/signals/leads/summary';
import { chatCompletion } from '@/lib/llm';
import { withTimeout } from '@/lib/util/timeout';

/**
 * - found: a usable description was produced (cache it on the lead).
 * - none:  we searched and there is genuinely nothing (cache "checked" so we
 *          don't refetch this lead every open).
 * - retry: timed out or a transient error - DO NOT cache; try again next open.
 *          Distinguishing this from `none` is critical: a slow-but-successful
 *          fetch must not get permanently written off as "nothing here".
 */
export type LeadDescriptionResult =
  | { status: 'found'; text: string; source: 'linkedin' | 'web' }
  | { status: 'none' }
  | { status: 'retry' };

/** Overall interactive budget; a miss past this returns `retry`, not `none`. */
const OVERALL_BUDGET_MS = 6000;
/** Per-network-call bound - tinyfish's own timeout is 170s, far too long here. */
const CALL_BUDGET_MS = 4500;
const MAX_SUMMARY_CHARS = 600;
const MAX_SOURCE_CHARS = 6000;

/** Grounding: the source text must actually mention the company (name/token/domain). */
export function mentionsCompany(text: string, lead: SignalLeadWithContacts): boolean {
  const hay = text.toLowerCase();
  const name = lead.company_name.trim().toLowerCase();
  if (name && hay.includes(name)) return true;
  const token = name.split(/\s+/)[0];
  if (token && token.length >= 4 && hay.includes(token)) return true;
  const domain = lead.domain?.trim().toLowerCase().replace(/^www\./, '');
  if (domain && hay.includes(domain)) return true;
  return false;
}

/**
 * Summarize a company's About from grounded source text. Returns '' when the
 * text doesn't describe the company or the model declines - never invents.
 */
async function summarizeFrom(text: string, lead: SignalLeadWithContacts): Promise<string> {
  const source = text.slice(0, MAX_SOURCE_CHARS);
  // Code-level grounding guard (mirrors extract-companies' isGroundedInSource):
  // don't even ask the model if the source clearly isn't about this company.
  if (!mentionsCompany(source, lead)) return '';
  const system = [
    `Write a 2-3 sentence factual "About" summary of the company "${lead.company_name}".`,
    'Use ONLY the provided source text. Do NOT invent facts, funding, customers, metrics, or claims.',
    'If the source text does not actually describe this company, reply with exactly: NONE.',
    'No preamble, no markdown - just the summary sentences.',
  ].join(' ');
  const user = `Source:\n${source}`;

  // The small (reasoning) model intermittently returns an empty completion; fall
  // back to the generate model before giving up. An explicit NONE or a grounding
  // miss is a genuine empty (''); an all-attempts failure THROWS so the caller
  // treats it as transient (retry) rather than caching "nothing found".
  let lastErr: unknown = null;
  for (const role of ['small', 'generate'] as const) {
    try {
      const raw = (await chatCompletion(system, user, { role, maxTokens: 500, temperature: 0.2 })).trim();
      if (/^none\b/i.test(raw)) return '';
      if (raw) return raw.slice(0, MAX_SUMMARY_CHARS);
      // Empty but no throw → treat as transient, try the next model.
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('summarize produced no content');
}

/** Runs the LinkedIn-About-then-Google fallback. `none` only after a real miss. */
async function core(lead: SignalLeadWithContacts): Promise<LeadDescriptionResult> {
  // 1) LinkedIn company About (only when we captured the company URL).
  const url = leadSourceUrl(lead);
  if (url && /linkedin\.com/i.test(url)) {
    const pages = await withTimeout(tinyfishFetch([url]), CALL_BUDGET_MS, []);
    const pageText = pages[0]?.text ?? '';
    if (pageText) {
      const text = await summarizeFrom(pageText, lead);
      if (text) return { status: 'found', text, source: 'linkedin' };
    }
  }

  // 2) Google search summary.
  const query = [lead.company_name, lead.domain ?? '', 'company overview'].filter(Boolean).join(' ');
  const results = await withTimeout(tinyfishSearch(query, 6), CALL_BUDGET_MS, []);
  const joined = results
    .map((r) => `${r.title ?? ''}\n${r.snippet ?? ''}`)
    .join('\n\n')
    .trim();
  if (joined) {
    const text = await summarizeFrom(joined, lead);
    if (text) return { status: 'found', text, source: 'web' };
  }

  return { status: 'none' };
}

/**
 * Best-effort company description for a lead with none stored. LinkedIn About
 * first (we have the company URL), then a Google-search summary, grounded so it
 * never fabricates. Time-boxed; a timeout or transient error returns `retry`
 * (not `none`) so a slow success is never cached as "nothing found".
 */
export async function resolveLeadDescription(
  lead: SignalLeadWithContacts,
): Promise<LeadDescriptionResult> {
  const TIMED_OUT = Symbol('timeout');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), OVERALL_BUDGET_MS);
  });
  try {
    // A thrown error (e.g. LLM quota) is transient → retry, not a genuine miss.
    const settled = await Promise.race([
      core(lead).catch((): LeadDescriptionResult => ({ status: 'retry' })),
      timeout,
    ]);
    return settled === TIMED_OUT ? { status: 'retry' } : settled;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
