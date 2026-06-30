import {
  ACCELERATOR_KEYWORDS,
  FUNDING_KEYWORDS,
  LAUNCH_KEYWORDS,
  SIGNAL_CONFIDENCE_THRESHOLD,
} from '@/lib/signals/defaults';
import type { ClassifiedSignal, IngestedPost, SignalType } from '@/lib/signals/types';

interface KeywordPack {
  type: SignalType;
  keywords: string[];
  weight: number;
}

const KEYWORD_PACKS: KeywordPack[] = [
  { type: 'accelerator_join', keywords: ACCELERATOR_KEYWORDS, weight: 0.9 },
  { type: 'funding_round', keywords: FUNDING_KEYWORDS, weight: 0.85 },
  { type: 'launch', keywords: LAUNCH_KEYWORDS, weight: 0.6 },
];

const YC_BATCH_RE = /\b(?:yc|y\s*combinator)\s*(?:batch\s*)?([sw]\d{2,3})\b/i;
const TECHSTARS_RE = /\btechstars\b/i;
const RAISED_RE = /\$(\d+(?:\.\d+)?)\s*(m|million|b|billion)?/i;

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function extractBatch(text: string): string | undefined {
  const m = text.match(YC_BATCH_RE);
  if (m) return m[1]?.toUpperCase();
  return undefined;
}

function extractAccelerator(text: string): string | undefined {
  if (YC_BATCH_RE.test(text) || /\by\s*combinator\b/i.test(text)) return 'Y Combinator';
  if (TECHSTARS_RE.test(text)) return 'Techstars';
  return undefined;
}

// Words that follow "building/founded/..." but are never a company name.
const COMPANY_STOPWORDS = new Set([
  'the', 'a', 'an', 'my', 'our', 'your', 'their', 'his', 'her', 'this', 'that',
  'these', 'those', 'new', 'modern', 'next', 'better', 'future', 'world', 'thing',
  'things', 'something', 'stuff', 'out', 'up', 'it', 'we', 'i', 'in', 'at', 'on',
  'and', 'with', 'for', 'to',
]);

/**
 * Extracts a company name from a post. Only accepts a capture that looks like a
 * proper noun or an @handle — never an article/adjective ("Building the future"
 * must NOT yield "the"). Returns undefined when no real company is found, so the
 * caller can fall back to the (always-present, trustworthy) author name.
 */
function extractCompanyHint(text: string): string | undefined {
  const buildingRe = /(?:building|founded|co-?founder(?:\s+at)?|ceo\s+at|cto\s+at|work\s+at)\s+(@[A-Za-z0-9_]{2,30}|[A-Z][A-Za-z0-9.&-]{1,30})/;
  const m = text.match(buildingRe);
  if (!m?.[1]) return undefined;

  const candidate = m[1];
  if (candidate.startsWith('@')) return candidate.slice(1);
  if (COMPANY_STOPWORDS.has(candidate.toLowerCase())) return undefined;
  // Require a proper-noun shape (leading uppercase) to avoid lowercase filler.
  if (!/^[A-Z]/.test(candidate)) return undefined;
  return candidate;
}

function extractPersonName(authorName?: string, authorHandle?: string): string | undefined {
  if (authorName?.trim()) return authorName.trim();
  if (authorHandle) return authorHandle.replace(/^@/, '');
  return undefined;
}

function buildSummary(
  signalType: SignalType,
  text: string,
  accelerator?: string,
  batch?: string,
): string {
  const snippet = text.slice(0, 160).replace(/\s+/g, ' ');
  if (signalType === 'accelerator_join' && accelerator) {
    const batchPart = batch ? ` (${batch})` : '';
    return `Accelerator signal: ${accelerator}${batchPart}. ${snippet}`;
  }
  if (signalType === 'funding_round') {
    const raised = text.match(RAISED_RE);
    const amt = raised ? raised[0] : 'funding';
    return `Funding signal: ${amt}. ${snippet}`;
  }
  return `${signalType.replace(/_/g, ' ')}: ${snippet}`;
}

/**
 * Rule-based GTM signal classifier (v1).
 * Returns null if confidence is below threshold.
 */
export function classifyPost(post: IngestedPost): ClassifiedSignal | null {
  const text = normalizeText(post.content);
  if (text.length < 20) return null;

  let bestType: SignalType = 'other';
  let bestScore = 0;
  const matched: string[] = [];

  for (const pack of KEYWORD_PACKS) {
    for (const kw of pack.keywords) {
      if (text.includes(kw.toLowerCase())) {
        matched.push(kw);
        const score = pack.weight * (1 + Math.min(matched.length, 3) * 0.05);
        if (score > bestScore) {
          bestScore = score;
          bestType = pack.type;
        }
      }
    }
  }

  if (bestScore < SIGNAL_CONFIDENCE_THRESHOLD) return null;

  const batch = extractBatch(post.content);
  const accelerator = extractAccelerator(post.content);
  const companyName = extractCompanyHint(post.content);
  const personName = extractPersonName(post.authorName, post.authorHandle);

  const dedupeKey = [
    bestType,
    // Prefer a real identity in the dedupe key so distinct signals with no valid
    // company name don't all collapse together (previously they collided on "the").
    companyName ?? personName ?? '',
    personName ?? '',
    batch ?? '',
  ].join('|').toLowerCase();

  return {
    signalType: bestType,
    companyName,
    personName,
    acceleratorName: accelerator,
    batch,
    signalSummary: buildSummary(bestType, post.content, accelerator, batch),
    confidence: Math.min(bestScore, 1),
    dedupeKey,
    matchedKeywords: matched,
  };
}

export { SIGNAL_CONFIDENCE_THRESHOLD };
