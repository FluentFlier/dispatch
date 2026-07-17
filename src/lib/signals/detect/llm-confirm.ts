import { chatCompletion } from '@/lib/llm';
import type { ClassifiedSignal, IngestedPost, SignalType } from '@/lib/signals/types';

const VALID_TYPES: SignalType[] = ['accelerator_join', 'funding_round', 'role_change', 'launch', 'keyword_match', 'field_change', 'other'];

interface LlmVerdict {
  is_signal: boolean;
  signal_type?: string;
  company_name?: string | null;
  person_name?: string | null;
  accelerator?: string | null;
  batch?: string | null;
  confidence?: number;
}

const SYSTEM = [
  'You are a GTM signal classifier for a sales team.',
  'Decide if a social post shows a startup joining an accelerator, raising funding, changing a founder role, or launching a product.',
  'Reply ONLY with compact JSON, no prose, no markdown fences.',
  'Schema: {"is_signal":bool,"signal_type":"accelerator_join|funding_round|role_change|launch|other","company_name":str|null,"person_name":str|null,"accelerator":str|null,"batch":str|null,"confidence":0-1}',
  'Set is_signal false for personal updates, opinions, memes, or generic marketing.',
].join(' ');

/**
 * Stage-2 detection: asks the LLM to confirm/deny a borderline post as a GTM
 * signal and extract entities. Used only on the borderline band so cost stays
 * bounded. Fails closed (returns null) on any parse/type error so junk never
 * becomes a false-positive lead.
 */
export async function confirmSignalWithLLM(post: IngestedPost): Promise<ClassifiedSignal | null> {
  const user = `Post by ${post.authorName ?? post.authorHandle ?? 'unknown'}:\n"""${post.content.slice(0, 1200)}"""`;
  let raw: string;
  try {
    raw = await chatCompletion(SYSTEM, user, { temperature: 0 });
  } catch {
    return null; // provider error -> fail closed, keyword stage already ran
  }

  const verdict = parseVerdict(raw);
  if (!verdict?.is_signal) return null;

  const signalType: SignalType = VALID_TYPES.includes(verdict.signal_type as SignalType)
    ? (verdict.signal_type as SignalType)
    : 'other';
  const companyName = verdict.company_name?.trim() || undefined;
  const personName = verdict.person_name?.trim() || post.authorName?.trim() || post.authorHandle?.replace(/^@/, '');
  const accelerator = verdict.accelerator?.trim() || undefined;
  const batch = verdict.batch?.trim() || undefined;
  const confidence = clamp01(verdict.confidence ?? 0.6);

  return {
    signalType,
    companyName,
    personName,
    acceleratorName: accelerator,
    batch,
    signalSummary: `${signalType.replace(/_/g, ' ')}: ${post.content.slice(0, 160).replace(/\s+/g, ' ')}`,
    confidence,
    dedupeKey: [signalType, companyName ?? personName ?? '', personName ?? '', batch ?? ''].join('|').toLowerCase(),
    matchedKeywords: ['llm'],
  };
}

/** Tolerant JSON parse: strips code fences, returns null on any failure. */
function parseVerdict(raw: string): LlmVerdict | null {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    const obj = JSON.parse(cleaned) as unknown;
    if (obj && typeof obj === 'object' && 'is_signal' in obj) return obj as LlmVerdict;
    return null;
  } catch {
    return null;
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.6;
  return Math.max(0, Math.min(1, n));
}
