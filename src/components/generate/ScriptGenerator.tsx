'use client';

import { useEffect, useState, useRef, useCallback, type KeyboardEvent, useMemo } from 'react';
import { AtSign, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { MicDictate } from './MicDictate';
import { assembleGeneratePrompt } from '@/lib/generate-prompt';
import { GenerateOutput, type GenerateVoiceMetrics } from './GenerateOutput';
import { usePillars, type PillarInfo } from '@/hooks/usePillars';
import { PLATFORMS } from '@/lib/constants';
import type { Platform } from '@/lib/constants';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { isPillarCovered } from '@/lib/pillar-dedup';
import { useCreatorPreferences, POST_LENGTH_CONFIG, type PostLength } from '@/hooks/useCreatorPreferences';
import {
  extractTagMentions,
  MAX_MENTIONS,
  mergeMentions,
  parseMentionList,
} from '@/lib/mentions';

const PILLAR_PROMPTS: Record<string, string> = {
  'hot-take': `Generate a hot take Reel script.
TOPIC (optional): [topic or "choose a strong angle based on the creator's real experience"]
HOOK: One bold controversial sentence. Stop-scrolling.
ARGUMENT: The actual claim, one sentence.
EVIDENCE: Specific proof or real example from the creator's background, one sentence.
FLIP: What they should do or think instead, one sentence.
CTA: One direct question.
Under 60 seconds when spoken. No em dashes. The creator's voice only.`,

  hackathon: `Generate a hackathon story Reel script. Draw from the creator's hackathon experience. Pick a specific, realistic, dramatic story.
HOOK: Drop into the most intense moment. No setup.
SETUP: 2 bullets -- challenge, stakes.
TURN: 1 bullet -- what changed under pressure.
LESSON: 1 bullet -- what this teaches about building.
CTA: Ask viewers about their own experience.
No em dashes.`,

  founder: `Generate a founder-in-public script about building the creator's product or startup.
HOOK: One honest vulnerable sentence. Real energy, no spin.
REALITY: 2 bullets -- what was hard or went wrong.
PROGRESS: 1 bullet -- one thing that moved.
LESSON: 1 bullet -- what this is teaching about startups.
CTA: Invite builders to share their week.
Sound like Tuesday at 11pm, not a success story. No em dashes.`,

  explainer: `Generate a concept explainer based on the creator's expertise. Under 60 seconds.
TOPIC (optional): [topic or "choose one concept from the creator's domain"]
HOOK: A question that makes them feel dumb for not knowing.
SIMPLE VERSION: 2 bullets, zero jargon. 16-year-old readable.
WHY IT MATTERS: 1 bullet.
MISCONCEPTION: 1 bullet.
CTA: Ask what to explain next.
No em dashes.`,

  origin: `Generate an origin/arc video script based on the creator's background and journey.
HOOK: One specific detail that makes someone lean in.
THE PATH: 2 bullets -- the unexpected parts.
THROUGH LINE: 1 bullet -- what actually connects it all.
NOW: 1 bullet -- where it's heading.
CTA: Invite non-linear paths in comments.
No em dashes.`,

  research: `Generate a research unlocked video script that makes the creator's research feel accessible and interesting.
HOOK: One line that makes someone who hates science want to keep watching.
THE WEIRD PART: 2 bullets -- what is genuinely surprising about the research.
WHY IT MATTERS: 1 bullet -- real-world stakes.
THE META LESSON: 1 bullet -- what doing research teaches you that classes do not.
CTA: Ask if they knew this kind of research existed.
No em dashes.`,
};

async function callGenerate(
  prompt: string,
  platform: Platform,
  useVoice: boolean,
  mentions: string[],
): Promise<{ text: string; voiceMetrics: GenerateVoiceMetrics }> {
  const res = await fetchWithAuth('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      platform,
      topic: prompt.slice(0, 200),
      useVoice,
      ...(mentions.length > 0 ? { mentions } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Generation failed');
  }
  const data = await res.json();
  return {
    text: data.text,
    voiceMetrics: {
      voice_match_score: data.voice_match_score,
      ai_score: data.ai_score,
      iterations: data.iterations,
      revised: data.revised,
      evaluation: data.evaluation,
      used_hook_ids: data.used_hook_ids,
      hook_explanations: data.hook_explanations,
      pipeline_stages: data.pipeline_stages,
      humanize_passes: data.humanize_passes,
    },
  };
}

interface ScriptGeneratorProps {
  initialResult?: string;
  initialTopic?: string;
  initialPillar?: string;
  initialPlatform?: Platform;
  /** Pre-filled @mentions (handles without @). Supports `tag@handle` in topic/thoughts too. */
  initialMentions?: string[];
  /** When true, auto-runs generation once on mount (welcome flow after onboarding). */
  autoGenerate?: boolean;
}

export function ScriptGenerator({
  initialResult = '',
  initialTopic = '',
  initialPillar = '',
  initialPlatform,
  initialMentions = [],
  autoGenerate = false,
}: ScriptGeneratorProps) {
  const mentionSeed = initialMentions.join(',');
  const stableInitialMentions = useMemo(
    () => mergeMentions(initialMentions),
    [mentionSeed, initialMentions],
  );
  const { pillars: pillarList, loading: pillarsLoading, getLabel } = usePillars();
  const { preferredPostLength, voiceEnabled, loading: prefLoading } = useCreatorPreferences();

  const [pillar, setPillar] = useState<string>(initialPillar);
  const [topic, setTopic] = useState(initialTopic);
  const [thoughts, setThoughts] = useState('');
  const [mentions, setMentions] = useState<string[]>(() => stableInitialMentions);

  // Sync tags when URL params change (e.g. /generate?tag=rudheer).
  useEffect(() => {
    if (stableInitialMentions.length > 0) {
      setMentions((prev) => mergeMentions(prev, stableInitialMentions));
    }
  }, [stableInitialMentions]);
  const [mentionInput, setMentionInput] = useState('');
  const [platform, setPlatform] = useState<Platform>(initialPlatform ?? 'instagram');
  const [postLength, setPostLength] = useState<PostLength>('standard');
  const [useVoice, setUseVoice] = useState(true);

  // Pillars pulled in from the suggestion catalog for THIS session (not saved to
  // profile) — lets you write from more pillars than your saved 3 without
  // committing them permanently.
  const [extraPillars, setExtraPillars] = useState<PillarInfo[]>([]);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<{ slug: string; name: string; description: string; tag: string }[]>([]);
  const [suggestLoaded, setSuggestLoaded] = useState(false);
  const [suggestQuery, setSuggestQuery] = useState('');

  const allPillars = [...pillarList, ...extraPillars];

  // Sync to profile defaults once loaded, if user hasn't manually changed them
  useEffect(() => {
    if (!prefLoading) {
      setPostLength(preferredPostLength);
      setUseVoice(voiceEnabled);
    }
  }, [prefLoading, preferredPostLength, voiceEnabled]);

  // Sync pillar state when custom pillars finish loading asynchronously
  useEffect(() => {
    if (pillarsLoading || pillarList.length === 0) return;
    // If pillar is still empty (no initial value), default to first loaded pillar
    if (!pillar) {
      setPillar(pillarList[0].value);
      return;
    }
    // Reset only if the picked pillar is neither a saved pillar nor a browsed one.
    const known = pillarList.some((p) => p.value === pillar) || extraPillars.some((p) => p.value === pillar);
    if (!known) {
      setPillar(pillarList[0].value);
    }
  }, [pillarsLoading, pillarList, extraPillars, pillar]);

  // Load the pillar suggestion catalog on first open of the browser.
  useEffect(() => {
    if (!browseOpen || suggestLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth('/api/pillars/suggestions');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        // Trending first, then curated; de-dupe by slug.
        const merged = [...(data.trending ?? []), ...(data.curated ?? [])]
          .filter((s, i, arr) => arr.findIndex((x) => x.slug === s.slug) === i);
        setSuggestions(merged);
      } catch {
        /* suggestions are optional */
      } finally {
        if (!cancelled) setSuggestLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [browseOpen, suggestLoaded]);

  const EXTRA_COLORS = ['#E07A5F', '#F59E0B', '#10B981', '#8B5CF6', '#3D8B7A', '#5A5047'];

  /** Add a catalog pillar to this session's pickable set and select it. */
  function pickSuggestion(s: { slug: string; name: string; description: string }) {
    if (!allPillars.some((p) => p.value === s.slug)) {
      setExtraPillars((prev) => [
        ...prev,
        { value: s.slug, label: s.name, color: EXTRA_COLORS[prev.length % EXTRA_COLORS.length], badgeBg: '', description: s.description },
      ]);
    }
    setPillar(s.slug);
  }
  const DRAFT_KEY = 'generate:script:draft';
  const [output, setOutput] = useState(() => {
    // Priority: prop (from URL params or Ideas page) > sessionStorage draft > empty
    if (initialResult) return initialResult;
    try { return sessionStorage.getItem(DRAFT_KEY) ?? ''; } catch { return ''; }
  });
  const [voiceMetrics, setVoiceMetrics] = useState<GenerateVoiceMetrics | undefined>();

  useEffect(() => {
    try { sessionStorage.setItem(DRAFT_KEY, output); } catch {}
  }, [output]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const autoGenTriggered = useRef(false);

  /** Add one or more handles from the tag input (comma/space separated). */
  function addMentionHandles(raw: string) {
    const next = mergeMentions(mentions, parseMentionList(raw));
    setMentions(next);
    setMentionInput('');
  }

  function removeMention(handle: string) {
    const key = handle.toLowerCase();
    setMentions((prev) => prev.filter((m) => m.toLowerCase() !== key));
  }

  function handleMentionKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (mentionInput.trim()) addMentionHandles(mentionInput);
    } else if (e.key === 'Backspace' && !mentionInput && mentions.length > 0) {
      setMentions((prev) => prev.slice(0, -1));
    }
  }

  const generate = useCallback(async () => {
    if (loading) return; // guard against double-submit (avoids duplicate /api/generate + 401 race)
    setLoading(true);
    setError('');
    setOutput('');
    setVoiceMetrics(undefined);
    try {
      const info = allPillars.find((p) => p.value === pillar);
      const pillarLabel = info?.label ?? getLabel(pillar);
      let base: string;
      if (info?.promptTemplate) {
        base = info.promptTemplate;
      } else if (PILLAR_PROMPTS[pillar]) {
        base = PILLAR_PROMPTS[pillar];
      } else {
        const isLongForm = platform === 'linkedin';
        base = isLongForm
          ? `Write a LinkedIn post for a "${pillarLabel}" angle. Creator's voice only. 200-350 words. No em dashes.
Hook: One strong first line.
Setup: 2-3 sentences of context or stakes.
Story or data: 2-4 sentences of specific detail.
Insight: 2-3 sentences of real takeaway.
CTA: One direct question.`
          : `Write a script for a "${pillarLabel}" post. The creator's voice only. Under 60 seconds when spoken. No em dashes.
HOOK: One bold first line.
BODY: 3-4 beats, each one sentence.
CTA: One direct question.`;
      }
      // Always includes the topic AND the braindump "thoughts" (length-capped
      // to the API limit) so nothing the user typed is silently dropped.
      const prompt = assembleGeneratePrompt({
        base,
        topic,
        thoughts,
        lengthHint: POST_LENGTH_CONFIG[postLength].hint,
      });
      const resolvedMentions = mergeMentions(
        mentions,
        extractTagMentions(topic),
        extractTagMentions(thoughts),
      );
      const result = await callGenerate(prompt, platform, useVoice, resolvedMentions);
      setOutput(result.text);
      setVoiceMetrics(result.voiceMetrics);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  }, [loading, allPillars, pillar, getLabel, platform, topic, thoughts, postLength, useVoice, mentions]);

  // Welcome flow: auto-draft the first post once pillars + prefs are loaded.
  useEffect(() => {
    if (!autoGenerate || autoGenTriggered.current || pillarsLoading || prefLoading) return;
    if (!topic.trim()) return;
    autoGenTriggered.current = true;
    void generate();
  }, [autoGenerate, pillarsLoading, prefLoading, topic, generate]);

  return (
    <div className="space-y-5">
      <div>
        <label className="block section-label mb-2">Content Pillar</label>
        <div className="flex flex-wrap gap-2">
          {/* Wait for the real pillars before rendering — avoids a flash of the
              default (hot-take/hackathon) pillars before the user's load in. */}
          {pillarsLoading ? (
            <div className="flex gap-2">
              <span className="h-8 w-24 animate-pulse rounded-[20px] bg-bg-tertiary" />
              <span className="h-8 w-28 animate-pulse rounded-[20px] bg-bg-tertiary" />
              <span className="h-8 w-20 animate-pulse rounded-[20px] bg-bg-tertiary" />
            </div>
          ) : (
            <>
              {allPillars.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPillar(p.value)}
                  className="px-4 py-1.5 rounded-[20px] font-body text-[13px] font-medium transition-all duration-100"
                  style={{
                    backgroundColor: '#F3EDE4',
                    color: pillar === p.value ? p.color : '#78716C',
                    border: pillar === p.value
                      ? `1.5px solid ${p.color}`
                      : '1px solid rgba(28, 25, 23, 0.1)',
                  }}
                >
                  {p.label}
                </button>
              ))}
              <button
                onClick={() => setBrowseOpen((o) => !o)}
                className="px-4 py-1.5 rounded-[20px] font-body text-[13px] font-medium text-text-secondary transition-all duration-100"
                style={{ border: '1px dashed rgba(28, 25, 23, 0.28)' }}
              >
                {browseOpen ? 'Close' : '+ More pillars'}
              </button>
            </>
          )}
        </div>

        {browseOpen && (
          <div className="mt-3 rounded-lg border border-border p-4">
            <input
              type="text"
              value={suggestQuery}
              onChange={(e) => setSuggestQuery(e.target.value)}
              placeholder="Search pillars..."
              className="w-full bg-bg-tertiary border border-border rounded-md px-3 py-2 font-body text-[13px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover"
            />
            {!suggestLoaded ? (
              <p className="mt-3 text-[12px] text-text-secondary">Loading suggestions...</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestions
                  // Hide suggestions the user effectively already has (incl. aliases
                  // like AI vs Artificial Intelligence) so the list doesn't bloat.
                  .filter((s) => !isPillarCovered(allPillars.map((p) => p.label), s.name))
                  .filter((s) => {
                    const q = suggestQuery.trim().toLowerCase();
                    if (!q) return true;
                    return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
                  })
                  .map((s) => {
                    const added = allPillars.some((p) => p.value === s.slug);
                    return (
                      <button
                        key={s.slug}
                        onClick={() => pickSuggestion(s)}
                        title={s.description}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] border transition-colors ${
                          added
                            ? 'border-border text-text-secondary opacity-60'
                            : 'border-border text-text-primary hover:border-accent-primary hover:text-accent-primary'
                        }`}
                      >
                        <span>{s.name}</span>
                        {s.tag === 'trending' && (
                          <span className="text-[9px] uppercase tracking-wide text-accent-primary">Trending</span>
                        )}
                        <span className="text-text-secondary">{added ? '✓' : '+'}</span>
                      </button>
                    );
                  })}
                {suggestions.length === 0 && (
                  <p className="text-[12px] text-text-secondary">No suggestions available.</p>
                )}
              </div>
            )}
            <p className="mt-3 text-[11px] text-text-tertiary">
              Picked here just for this draft. Add pillars permanently in Settings &rarr; Profile.
            </p>
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="section-label">Topic (optional)</label>
          <MicDictate onText={(t) => setTopic((cur) => (cur ? `${cur} ${t}` : t))} title="Dictate topic" />
        </div>
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          rows={2}
          placeholder="Enter a specific topic or leave blank for a general script..."
          className="w-full bg-bg-tertiary border border-border rounded-md px-4 py-3 font-body text-[13px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover resize-none transition-colors duration-100"
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="section-label">Your thoughts (optional)</label>
          <MicDictate onText={(t) => setThoughts((cur) => (cur ? `${cur} ${t}` : t))} title="Dictate your thoughts" />
        </div>
        <textarea
          value={thoughts}
          onChange={(e) => setThoughts(e.target.value)}
          rows={4}
          placeholder="Dump the details, facts, angle, or story you want in this post. Speak or type. This is always sent to the AI."
          className="w-full bg-bg-tertiary border border-border rounded-md px-4 py-3 font-body text-[13px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover resize-y transition-colors duration-100"
        />
      </div>

      <div>
        <label className="block section-label mb-2">
          Tag people
          <span className="ml-2 text-text-tertiary font-normal normal-case tracking-normal">
            (LinkedIn @mentions woven into the draft)
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-bg-tertiary px-3 py-2">
          <AtSign className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
          {mentions.map((handle) => (
            <span
              key={handle}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-paper px-2.5 py-0.5 font-body text-[12px] text-text-primary"
            >
              @{handle}
              <button
                type="button"
                onClick={() => removeMention(handle)}
                className="rounded-full p-0.5 text-text-secondary hover:text-text-primary"
                aria-label={`Remove @${handle}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {mentions.length < MAX_MENTIONS && (
            <input
              type="text"
              value={mentionInput}
              onChange={(e) => setMentionInput(e.target.value)}
              onKeyDown={handleMentionKeyDown}
              onBlur={() => {
                if (mentionInput.trim()) addMentionHandles(mentionInput);
              }}
              placeholder={mentions.length === 0 ? 'rudheer — or type tag@rudheer in thoughts' : 'Add another…'}
              className="min-w-[120px] flex-1 bg-transparent py-1 font-body text-[13px] text-text-primary placeholder:text-text-secondary focus:outline-none"
            />
          )}
        </div>
        {mentions.length >= MAX_MENTIONS && (
          <p className="mt-1 text-[11px] text-text-tertiary">Max {MAX_MENTIONS} tags per post.</p>
        )}
      </div>

      <div>
        <label className="block section-label mb-2">
          Target Platform
        </label>
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className="px-4 py-1.5 rounded-[20px] font-body text-[13px] font-medium transition-all duration-100"
              style={{
                backgroundColor: '#F3EDE4',
                color: platform === p ? '#1C1917' : '#78716C',
                border: platform === p
                  ? '1.5px solid rgba(28, 25, 23, 0.28)'
                  : '1px solid rgba(28, 25, 23, 0.1)',
              }}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block section-label mb-2">
          Post Length
          <span className="ml-2 text-text-tertiary font-normal normal-case tracking-normal">
            (from your profile default — override per post)
          </span>
        </label>
        <div className="flex gap-2">
          {(Object.keys(POST_LENGTH_CONFIG) as PostLength[]).map((len) => (
            <button
              key={len}
              onClick={() => setPostLength(len)}
              className="px-4 py-1.5 rounded-[20px] font-body text-[13px] font-medium transition-all duration-100"
              style={{
                backgroundColor: '#F3EDE4',
                color: postLength === len ? '#1C1917' : '#78716C',
                border: postLength === len
                  ? '1.5px solid rgba(28, 25, 23, 0.28)'
                  : '1px solid rgba(28, 25, 23, 0.1)',
              }}
            >
              {POST_LENGTH_CONFIG[len].label}
              <span className="ml-1 text-[11px] opacity-60">~{POST_LENGTH_CONFIG[len].words}w</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border border-border bg-bg-tertiary px-4 py-3">
        <div>
          <p className="text-[13px] font-medium text-text-primary">Use my voice</p>
          <p className="text-[11px] text-text-secondary">
            {useVoice
              ? 'Drafts sound like you, learned from your profile + posts.'
              : 'Off: generate a clean, neutral draft with no personal voice applied.'}
          </p>
        </div>
        <Toggle checked={useVoice} onChange={setUseVoice} label="Use my voice" />
      </div>

      <Button onClick={generate} loading={loading}>
        Generate
      </Button>

      {error && <p className="font-body text-[13px] text-accent-primary">{error}</p>}

      <GenerateOutput
        text={output}
        loading={loading}
        sourcePlatform={platform}
        voiceMetrics={voiceMetrics}
        onTextUpdate={(newText) => setOutput(newText)}
      />
    </div>
  );
}
