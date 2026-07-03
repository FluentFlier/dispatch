import type { ContentPillarConfig } from '@/types/database';

const PILLAR_COLORS = ['#E07A5F', '#D4A054', '#3D8B7A', '#8B7BB8', '#DC6B5C'];

export interface VoiceAnalysisResult {
  analysis: Record<string, unknown>;
  voice_summary: string;
  voice_rules: string[];
  gap_questions?: Array<{ id: string; question: string; why: string }>;
}

export interface CreatorBaseline {
  voiceSummary: string;
  voiceRules: string[];
  themes: string[];
  hookPattern: string;
  tone: string;
  postsAnalyzed: number;
  platforms: string[];
  displayName: string;
  suggestedTopic: string;
  pillars: ContentPillarConfig[];
}

/**
 * Builds the Stanley-style "Creator Baseline" report from voice analysis output
 * so onboarding can show value before asking for manual profile setup.
 */
export function buildCreatorBaseline(
  analysis: VoiceAnalysisResult,
  opts: {
    postsAnalyzed: number;
    platforms: string[];
    displayName: string;
  },
): CreatorBaseline {
  const a = analysis.analysis;
  const tone = typeof a.tone === 'string' ? a.tone : 'Conversational and direct';
  const hookPattern =
    typeof a.opening_patterns === 'string'
      ? a.opening_patterns
      : 'Opens with a bold claim or question';

  const signaturePhrases = Array.isArray(a.signature_phrases)
    ? (a.signature_phrases as string[]).filter(Boolean)
    : [];

  const themes = inferThemes(analysis, signaturePhrases);
  const pillars = themes.slice(0, 3).map((name, i) => ({
    name,
    color: PILLAR_COLORS[i % PILLAR_COLORS.length],
    description: `Content about ${name.toLowerCase()}`,
  }));

  const suggestedTopic = buildSuggestedTopic(themes, tone);

  return {
    voiceSummary: analysis.voice_summary,
    voiceRules: analysis.voice_rules ?? [],
    themes,
    hookPattern,
    tone,
    postsAnalyzed: opts.postsAnalyzed,
    platforms: opts.platforms,
    displayName: opts.displayName,
    suggestedTopic,
    pillars: pillars.length > 0 ? pillars : [{ name: 'Insights', color: PILLAR_COLORS[0], description: 'Your core ideas' }],
  };
}

function inferThemes(analysis: VoiceAnalysisResult, signaturePhrases: string[]): string[] {
  const candidates: string[] = [];

  if (typeof analysis.analysis.content_structure === 'string') {
    const words = analysis.analysis.content_structure.split(/\s+/).slice(0, 3);
    if (words.length) candidates.push(capitalize(words.join(' ')));
  }

  for (const phrase of signaturePhrases.slice(0, 2)) {
    const theme = phrase.split(/\s+/).slice(0, 2).join(' ');
    if (theme.length > 3) candidates.push(capitalize(theme));
  }

  const summaryWords = analysis.voice_summary
    .replace(/[^a-zA-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 4)
    .slice(0, 3);

  for (const word of summaryWords) {
    candidates.push(capitalize(word));
  }

  const unique = Array.from(new Set(candidates.map((c) => c.trim()).filter(Boolean)));
  return unique.slice(0, 4);
}

function buildSuggestedTopic(themes: string[], tone: string): string {
  const theme = themes[0] ?? 'what you shipped this week';
  const toneHint = tone.toLowerCase().includes('professional')
    ? 'A practical takeaway'
    : 'A honest lesson';
  return `${toneHint} about ${theme.toLowerCase()}`;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
