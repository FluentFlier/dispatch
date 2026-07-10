import { generateContent } from './ai';
import type { CreatorProfileForPrompt } from './ai';
import { chatCompletion } from './llm';
import { HfInference } from '@huggingface/inference';
import type { VocabularyFingerprint } from './voice-context';
import {
  HUMANIZE_AUDIT_PROMPT,
  HUMANIZE_CLEAN_PROMPT,
  HUMANIZER_PROMPT,
  VOICE_APPLY_PROMPT,
} from './humanizer-prompts';

export type HumanizePass = 'pre_clean' | 'clean' | 'audit' | 'voice';

export interface HumanizePipelineResult {
  text: string;
  passes: HumanizePass[];
}

/**
 * Deterministic AI-writing patterns. Each match is a "tell" that the text reads
 * like generic LLM output. Used as a floor under the ML detector and for cheap pre-clean.
 */
export const AI_SLOP_PATTERNS: RegExp[] = [
  /\b(delve|tapestry|leverage|foster|landscape|nuanced|multifaceted|comprehensive|robust|holistic|pivotal|crucial|paramount|innovative|transformative|utilize|realm|underscore|testament|seamless|elevate|empower|unlock|harness|navigate|cultivate|embark|profound)\b/gi,
  /\bin today'?s (?:fast-paced |digital |modern |competitive )?world\b/gi,
  /\bit'?s (?:worth|important) (?:noting|to note|mentioning)\b/gi,
  /\b(?:in conclusion|to sum up|in summary|ultimately,|at the end of the day)\b/gi,
  /\blet'?s (?:dive|unpack|explore|break (?:it|this) down)\b/gi,
  /\bnot only\b[^.]*\bbut also\b/gi,
  /\bwhether you'?re\b/gi,
  /\bgame[- ]chang(?:er|ing)\b/gi,
  /—/g,
  /–/g,
];

const AI_WORD_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\butilize\b/gi, 'use'],
  [/\bleverage\b/gi, 'use'],
  [/\bdelve\b/gi, 'look'],
  [/\brobust\b/gi, 'solid'],
  [/\bpivotal\b/gi, 'key'],
  [/\blandscape\b/gi, 'space'],
  [/\bnuanced\b/gi, 'subtle'],
  [/\bcomprehensive\b/gi, 'full'],
  [/\bholistic\b/gi, 'whole'],
  [/\btransformative\b/gi, 'big'],
  [/\binnovative\b/gi, 'new'],
  [/\bit'?s worth noting that\b/gi, ''],
  [/\bin today'?s world\b/gi, ''],
  [/\bin conclusion\b/gi, ''],
  [/\bat the end of the day\b/gi, ''],
];

/**
 * Zero-LLM pass: strip obvious AI vocabulary and em dashes before expensive
 * rewrites. `preserve` protects the creator's own words (uses_often /
 * signature_phrases) - if THEY genuinely say "robust", we keep it.
 * Whitespace: collapse runs of spaces/tabs only; paragraph breaks (\n\n) are
 * layout on LinkedIn/X and must survive.
 */
export function deterministicPreClean(text: string, preserve: string[] = []): string {
  const keep = new Set(preserve.map((w) => w.toLowerCase().trim()).filter(Boolean));
  let out = text.replace(/—/g, ' - ').replace(/–/g, '-');
  for (const [re, replacement] of AI_WORD_REPLACEMENTS) {
    out = out.replace(re, (match) => (keep.has(match.toLowerCase()) ? match : replacement));
  }
  return out
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripEmDashes(text: string): string {
  return text.replace(/—/g, ' - ').replace(/–/g, '-');
}

function buildVoiceContextBlock(profile?: CreatorProfileForPrompt | null): string {
  if (!profile) return '';
  return `\n\nVOICE TO MATCH:\nName: ${profile.display_name}\n${profile.bio_facts ? `Background: ${profile.bio_facts}\n` : ''}${profile.voice_description ? `Voice: ${profile.voice_description}\n` : ''}${profile.voice_rules ? `Rules: ${profile.voice_rules}` : ''}`;
}

function preserveBlock(preserve: string[]): string {
  const items = preserve.map((w) => w.trim()).filter(Boolean);
  if (items.length === 0) return '';
  return `\n\nPRESERVE THESE CREATOR WORDS/PHRASES (their real voice - never remove, replace, or rephrase them): ${items.join(', ')}`;
}

/**
 * Pass 1: Remove AI patterns without applying creator voice.
 */
export async function humanizeClean(text: string, preserve: string[] = []): Promise<string> {
  const result = await generateContent(
    `Humanize this text (remove AI tells only):\n\n---\n${text}\n---`,
    undefined,
    HUMANIZE_CLEAN_PROMPT + preserveBlock(preserve),
  );
  return stripEmDashes(result.trim());
}

/**
 * Pass 2: Final audit - catch anything the first pass missed.
 */
export async function humanizeAudit(text: string, preserve: string[] = []): Promise<string> {
  const result = await generateContent(
    `Audit this draft:\n\n---\n${text}\n---`,
    undefined,
    HUMANIZE_AUDIT_PROMPT + preserveBlock(preserve),
  );
  return stripEmDashes(result.trim());
}

/**
 * Pass 3: Apply creator voice identity (run AFTER humanize passes).
 */
export async function applyCreatorVoice(
  text: string,
  profile: CreatorProfileForPrompt | null,
  contextAdditions?: string,
): Promise<string> {
  if (!profile?.voice_description && !profile?.voice_rules) {
    return text;
  }

  const voiceBlock = buildVoiceContextBlock(profile);
  const contextBlock = contextAdditions?.trim()
    ? `\n\nCREATOR CONTEXT:\n${contextAdditions.trim()}`
    : '';

  const result = await chatCompletion(
    `${VOICE_APPLY_PROMPT}${voiceBlock}${contextBlock}`,
    `Rewrite in this creator's voice:\n\n---\n${text}\n---`,
    { temperature: 0.65 },
  );
  return stripEmDashes(result.trim());
}

export interface HumanizePipelineOptions {
  profile?: CreatorProfileForPrompt | null;
  contextAdditions?: string;
  /** Skip voice pass (humanize only). */
  skipVoice?: boolean;
  /** Skip audit pass (faster, lower quality). */
  skipAudit?: boolean;
  /** Creator fingerprint - uses_often + signature_phrases become a PRESERVE list. */
  vocabulary?: VocabularyFingerprint;
}

/**
 * Full 3-pass humanization for creator content: pre-clean → LLM clean → audit → voice.
 * Separating voice from slop-removal prevents the model from averaging toward generic.
 */
export async function humanizePipeline(
  text: string,
  options: HumanizePipelineOptions = {},
): Promise<HumanizePipelineResult> {
  const passes: HumanizePass[] = [];

  const preserve = [
    ...(options.vocabulary?.uses_often ?? []),
    ...(options.vocabulary?.signature_phrases ?? []),
  ];

  let working = deterministicPreClean(text, preserve);
  passes.push('pre_clean');

  working = await humanizeClean(working, preserve);
  passes.push('clean');

  if (!options.skipAudit) {
    working = await humanizeAudit(working, preserve);
    passes.push('audit');
  }

  if (!options.skipVoice && options.profile) {
    working = await applyCreatorVoice(working, options.profile, options.contextAdditions);
    passes.push('voice');
  }

  return { text: working, passes };
}

/**
 * Single-pass humanize (legacy / manual Humanize button).
 * Prefer humanizePipeline for generation.
 */
export async function humanize(
  text: string,
  profile?: CreatorProfileForPrompt | null,
): Promise<string> {
  const voiceContext = buildVoiceContextBlock(profile);
  const result = await generateContent(
    `Humanize this text:${voiceContext}\n\n---\n${text}\n---`,
    undefined,
    HUMANIZER_PROMPT,
  );
  return stripEmDashes(result.trim());
}

function heuristicAiScore(text: string): number {
  let hits = 0;
  for (const re of AI_SLOP_PATTERNS) {
    const matches = text.match(re);
    if (matches) hits += matches.length;
  }
  return Math.min(100, hits * 12);
}

function chunkForDetector(text: string, maxChunks = 3): string[] {
  const size = 480;
  const chunks: string[] = [];
  for (let i = 0; i < text.length && chunks.length < maxChunks; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks.length > 0 ? chunks : [text];
}

/**
 * Score how "AI-sounding" text is (0-100, higher = more AI).
 */
export async function aiScore(text: string): Promise<{ score: number; flags: string[] }> {
  const heuristic = heuristicAiScore(text);

  let modelScore: number | null = null;
  try {
    const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);
    const chunks = chunkForDetector(text);
    const results = await Promise.all(
      chunks.map((chunk) =>
        hf.textClassification({ model: 'Hello-SimpleAI/chatgpt-detector-roberta', inputs: chunk }),
      ),
    );

    const chunkScores = results.map((result) => {
      const ai = result.find((r) => /chat\s?gpt|^ai$|fake|label_1/i.test(r.label));
      if (ai) return ai.score;
      const human = result.find((r) => /human|label_0/i.test(r.label));
      if (human) return 1 - human.score;
      return null;
    });

    const valid = chunkScores.filter((s): s is number => s !== null);
    if (valid.length > 0) modelScore = Math.round(Math.max(...valid) * 100);
  } catch {
    modelScore = null;
  }

  const score = modelScore === null ? heuristic : Math.max(modelScore, heuristic);
  const flags: string[] = [];
  if (modelScore === null) flags.push('model_unavailable');
  if (score > 70) flags.push('detected_as_ai');
  return { score, flags };
}
