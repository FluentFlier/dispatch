'use client';

import { useEffect, useState, useRef, useCallback, type KeyboardEvent, useMemo } from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';
import { MicDictate } from './MicDictate';
import { assembleGeneratePrompt } from '@/lib/generate-prompt';
import { GenerateOutput, type GenerateVoiceMetrics } from './GenerateOutput';
import { usePillars } from '@/hooks/usePillars';
import { PLATFORMS, PLATFORM_LABELS, normalizeDashboardPlatform, type DashboardPlatform } from '@/lib/constants';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { useCreatorPreferences, POST_LENGTH_CONFIG } from '@/hooks/useCreatorPreferences';
import {
  extractTagMentions,
  mergeMentions,
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

type ChatMessage =
  | { id: string; role: 'user'; content: string }
  | { id: string; role: 'assistant'; content: string; voiceMetrics?: GenerateVoiceMetrics };

function isPlatform(value: unknown): value is DashboardPlatform {
  return value === 'twitter' || value === 'linkedin';
}

async function fetchDefaultPlatform(): Promise<DashboardPlatform> {
  try {
    const res = await fetch('/api/settings?key=platform_defaults', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return 'linkedin';
    const data = await res.json();
    const raw = data?.setting?.value;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return isPlatform(parsed?.defaultPlatform) ? parsed.defaultPlatform : 'linkedin';
  } catch {
    return 'linkedin';
  }
}

async function callGenerate(
  prompt: string,
  platform: DashboardPlatform,
  useVoice: boolean,
  mentions: string[],
): Promise<{ text: string; voiceMetrics: GenerateVoiceMetrics; completeness: { starved?: boolean; voiceSource?: string } | null }> {
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
    completeness: data.context_completeness ?? null,
  };
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildFirstDraftBase(
  pillar: string,
  pillarLabel: string,
  platform: DashboardPlatform,
  promptTemplate?: string,
): string {
  if (promptTemplate) return promptTemplate;
  if (PILLAR_PROMPTS[pillar]) return PILLAR_PROMPTS[pillar];
  if (platform === 'linkedin') {
    return `Write a LinkedIn post. Creator's voice only. 200-350 words. No em dashes.
Hook: One strong first line.
Setup: 2-3 sentences of context or stakes.
Story or data: 2-4 sentences of specific detail.
Insight: 2-3 sentences of real takeaway.
CTA: One direct question.`;
  }
  return `Write a ${platform} post script. Creator's voice only. Under 60 seconds when spoken. No em dashes.
HOOK: One bold first line.
BODY: 3-4 beats, each one sentence.
CTA: One direct question.`;
}

interface ScriptGeneratorProps {
  initialResult?: string;
  initialTopic?: string;
  initialPillar?: string;
  initialPlatform?: DashboardPlatform;
  initialMentions?: string[];
  autoGenerate?: boolean;
}

const CHAT_KEY = 'generate:script:chat';

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

  const [pillar, setPillar] = useState(initialPillar);
  const [input, setInput] = useState('');
  const [platform, setPlatform] = useState<DashboardPlatform>(initialPlatform ?? 'linkedin');
  const [postLength, setPostLength] = useState(preferredPostLength);
  const [useVoice, setUseVoice] = useState(voiceEnabled);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (initialResult) {
      return [{ id: newId(), role: 'assistant', content: initialResult }];
    }
    try {
      const raw = sessionStorage.getItem(CHAT_KEY);
      if (raw) return JSON.parse(raw) as ChatMessage[];
    } catch { /* ignore */ }
    return [];
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [completeness, setCompleteness] = useState<{ starved?: boolean; voiceSource?: string } | null>(null);
  const autoGenTriggered = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const lastDraft = [...messages].reverse().find((m) => m.role === 'assistant')?.content ?? '';
  const lastAssistantIdx = messages.findLastIndex((m) => m.role === 'assistant');

  useEffect(() => {
    if (initialPlatform) return;
    let cancelled = false;
    void fetchDefaultPlatform().then((p) => {
      if (!cancelled) setPlatform(p);
    });
    return () => { cancelled = true; };
  }, [initialPlatform]);

  useEffect(() => {
    if (!prefLoading) {
      setPostLength(preferredPostLength);
      setUseVoice(voiceEnabled);
    }
  }, [prefLoading, preferredPostLength, voiceEnabled]);

  useEffect(() => {
    if (pillarsLoading || pillarList.length === 0) return;
    if (!pillar) setPillar(pillarList[0].value);
    else if (!pillarList.some((p) => p.value === pillar)) setPillar(pillarList[0].value);
  }, [pillarsLoading, pillarList, pillar]);

  useEffect(() => {
    try { sessionStorage.setItem(CHAT_KEY, JSON.stringify(messages)); } catch {}
  }, [messages]);

  // Scroll only the chat pane — scrollIntoView would also move ancestor
  // containers and jump the whole page down to the latest draft.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading || pillarsLoading || prefLoading || !pillar) return;

    const userMsg: ChatMessage = { id: newId(), role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setError('');

    try {
      const info = pillarList.find((p) => p.value === pillar);
      const pillarLabel = info?.label ?? getLabel(pillar);
      const priorDraft = [...messages].reverse().find((m) => m.role === 'assistant')?.content;

      let assembled: string;
      if (priorDraft) {
        assembled = assembleGeneratePrompt({
          base: `Revise this ${platform} post based on the creator's latest message. Return ONLY the updated post — no commentary, no labels.`,
          thoughts: `CURRENT DRAFT:\n${priorDraft}\n\nCREATOR SAID:\n${trimmed}`,
          lengthHint: POST_LENGTH_CONFIG[postLength].hint,
        });
      } else {
        const base = buildFirstDraftBase(pillar, pillarLabel, platform, info?.promptTemplate);
        assembled = assembleGeneratePrompt({
          base,
          thoughts: trimmed,
          lengthHint: POST_LENGTH_CONFIG[postLength].hint,
        });
      }

      const mentions = mergeMentions(stableInitialMentions, extractTagMentions(trimmed));
      const result = await callGenerate(assembled, platform, useVoice, mentions);
      const assistantMsg: ChatMessage = {
        id: newId(),
        role: 'assistant',
        content: result.text,
        voiceMetrics: result.voiceMetrics,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setCompleteness(useVoice ? result.completeness : null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
      setInput(trimmed);
    } finally {
      setLoading(false);
    }
  }, [
    loading, pillarsLoading, prefLoading, pillar, pillarList, getLabel,
    platform, postLength, useVoice, stableInitialMentions, messages,
  ]);

  useEffect(() => {
    if (!autoGenerate || autoGenTriggered.current || pillarsLoading || prefLoading || !pillar) return;
    if (!initialTopic.trim()) return;
    autoGenTriggered.current = true;
    void sendMessage(initialTopic);
  }, [autoGenerate, pillarsLoading, prefLoading, initialTopic, pillar, sendMessage]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  }

  function updateDraft(text: string) {
    if (lastAssistantIdx < 0) return;
    setMessages((prev) =>
      prev.map((m, i) => (i === lastAssistantIdx && m.role === 'assistant' ? { ...m, content: text } : m)),
    );
  }

  const platformLabel = PLATFORM_LABELS[platform];
  const isEmpty = messages.length === 0 && !loading;

  return (
    <div className="flex min-h-[calc(100vh-10rem)] flex-col">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pb-4">
        {isEmpty && (
          <div className="py-12 text-center">
            <h1 className="font-serif text-[1.75rem] font-normal tracking-[-0.03em] text-ink sm:text-[2rem]">
              What are we creating today?
            </h1>
            <p className="mt-2 text-sm text-ink3">
              Tell me the idea — I&apos;ll draft it in your voice for {platformLabel}.
            </p>
          </div>
        )}

        {messages.map((msg, idx) =>
          msg.role === 'user' ? (
            <div key={msg.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl bg-ink px-4 py-2.5 text-[15px] leading-relaxed text-white">
                {msg.content}
              </div>
            </div>
          ) : (
            <div key={msg.id} className="flex justify-start">
              {idx === lastAssistantIdx ? (
                <div className="w-full max-w-full">
                  <GenerateOutput
                    text={msg.content}
                    loading={false}
                    sourcePlatform={platform}
                    voiceMetrics={msg.voiceMetrics}
                    completeness={completeness}
                    onTextUpdate={updateDraft}
                    variant="simple"
                    savePillar={pillar}
                  />
                </div>
              ) : (
                <div className="max-w-[90%] rounded-2xl border border-hair bg-paper2 px-4 py-3 text-[14px] leading-relaxed text-ink2 whitespace-pre-wrap">
                  {msg.content}
                </div>
              )}
            </div>
          ),
        )}

        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl border border-hair bg-paper px-4 py-3 text-sm text-ink3">
              <Loader2 className="h-4 w-4 animate-spin" />
              Drafting…
            </div>
          </div>
        )}

        {error && (
          <p className="text-center text-[13px] text-accent-primary">{error}</p>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="sticky bottom-0 rounded-2xl border border-hair bg-paper shadow-soft">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          autoFocus
          placeholder={lastDraft ? 'Ask for changes — shorter, punchier hook, add a CTA…' : 'What do you want to post about?'}
          className="w-full resize-none rounded-t-2xl bg-transparent px-4 py-3 font-body text-[15px] leading-relaxed text-ink placeholder:text-ink3 focus:outline-none"
        />
        <div className="flex items-center justify-between border-t border-hair px-3 py-2">
          <MicDictate
            onText={(t) => setInput((cur) => (cur ? `${cur} ${t}` : t))}
            title="Dictate"
          />
          <button
            type="button"
            onClick={() => void sendMessage(input)}
            disabled={loading || !input.trim() || pillarsLoading}
            aria-label="Send"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
