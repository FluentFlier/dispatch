'use client';

import { useEffect, useState, useRef, useCallback, type KeyboardEvent, useMemo } from 'react';
import { ArrowUp, Loader2, Square, Plus } from 'lucide-react';
import { MicDictate } from './MicDictate';
import { assembleGeneratePrompt } from '@/lib/generate-prompt';
import { GenerateOutput, type GenerateVoiceMetrics } from './GenerateOutput';
import { usePillars } from '@/hooks/usePillars';
import { DASHBOARD_PLATFORMS, PLATFORM_LABELS, type DashboardPlatform } from '@/lib/constants';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { useCreatorPreferences, POST_LENGTH_CONFIG, type PostLength } from '@/hooks/useCreatorPreferences';
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

type GenStage = 'thinking' | 'writing' | 'revising';

type StreamEvent =
  | { type: 'stage'; stage: GenStage }
  | { type: 'token'; delta: string }
  | { type: 'done'; text: string; used_hook_ids?: string[] }
  | { type: 'error'; error: string };

const STAGE_LABELS: Record<GenStage, string> = {
  thinking: 'Thinking through the angle…',
  writing: 'Writing your draft…',
  revising: 'Reworking the draft…',
};

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

/**
 * Streams a generation over SSE, calling `onEvent` for each parsed event.
 * Throws on transport/HTTP errors and on server-sent `error` events.
 */
async function streamGenerate(
  payload: Record<string, unknown>,
  onEvent: (ev: StreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetchWithAuth('/api/generate/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'Generation failed');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const evt of events) {
      const line = evt.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as StreamEvent);
      } catch {
        // Ignore keepalive/comment lines and malformed frames.
      }
    }
  }
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
  const { preferredPostLength, voiceEnabled, loading: prefLoading, savePreferredPostLength } = useCreatorPreferences();

  const [pillar, setPillar] = useState(initialPillar);
  const [input, setInput] = useState('');
  const [platform, setPlatform] = useState<DashboardPlatform>(initialPlatform ?? 'linkedin');
  const [postLength, setPostLength] = useState<PostLength>(preferredPostLength);
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
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [stage, setStage] = useState<GenStage | null>(null);
  const [error, setError] = useState('');
  const autoGenTriggered = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Token flushing is batched to one rAF tick so a fast stream doesn't trigger a
  // React re-render (and JSON.stringify to sessionStorage) on every single token.
  const flushRef = useRef<{ id: string; text: string } | null>(null);
  const rafRef = useRef<number | null>(null);

  const lastDraft = [...messages].reverse().find((m) => m.role === 'assistant' && m.content.trim())?.content ?? '';
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

  // Persist chat, but never mid-stream: writing a growing draft on every token
  // would stringify the whole history hundreds of times per generation.
  useEffect(() => {
    if (streamingId) return;
    try { sessionStorage.setItem(CHAT_KEY, JSON.stringify(messages)); } catch {}
  }, [messages, streamingId]);

  // Scroll only the chat pane — scrollIntoView would also move ancestor
  // containers and jump the whole page down to the latest draft.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const scheduleFlush = useCallback((id: string, text: string) => {
    flushRef.current = { id, text };
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const pending = flushRef.current;
      if (!pending) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === pending.id && m.role === 'assistant' ? { ...m, content: pending.text } : m)),
      );
    });
  }, []);

  const finalizeMessage = useCallback((id: string, text: string, hookIds: string[]) => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    flushRef.current = null;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id && m.role === 'assistant'
          ? { ...m, content: text, voiceMetrics: { used_hook_ids: hookIds } }
          : m,
      ),
    );
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading || pillarsLoading || prefLoading || !pillar) return;

    const priorDraft = [...messages].reverse().find((m) => m.role === 'assistant' && m.content.trim())?.content;
    const info = pillarList.find((p) => p.value === pillar);
    const pillarLabel = info?.label ?? getLabel(pillar);
    const mode: 'draft' | 'revise' = priorDraft ? 'revise' : 'draft';

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

    const userMsg: ChatMessage = { id: newId(), role: 'user', content: trimmed };
    const assistantId = newId();
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '' }]);
    setInput('');
    setError('');
    setLoading(true);
    setStreamingId(assistantId);
    setStage(mode === 'revise' ? 'revising' : 'thinking');

    const controller = new AbortController();
    abortRef.current = controller;
    let acc = '';
    let finalized = false;

    try {
      await streamGenerate(
        {
          prompt: assembled,
          topic: assembled.slice(0, 200),
          platform,
          useVoice,
          mode,
          ...(mentions.length > 0 ? { mentions } : {}),
        },
        (ev) => {
          if (ev.type === 'stage') {
            setStage(ev.stage);
          } else if (ev.type === 'token') {
            acc += ev.delta;
            scheduleFlush(assistantId, acc);
          } else if (ev.type === 'done') {
            finalized = true;
            finalizeMessage(assistantId, ev.text || acc, ev.used_hook_ids ?? []);
          } else if (ev.type === 'error') {
            throw new Error(ev.error);
          }
        },
        controller.signal,
      );
      // Stream closed without a done event (e.g. user hit Stop): keep partial text.
      if (!finalized) {
        if (acc.trim()) {
          finalizeMessage(assistantId, acc, []);
        } else {
          // Nothing streamed yet — drop the exchange and hand the prompt back.
          setMessages((prev) => prev.filter((m) => m.id !== assistantId && m.id !== userMsg.id));
          setInput(trimmed);
        }
      }
    } catch (e: unknown) {
      const aborted = controller.signal.aborted;
      if (aborted && acc.trim()) {
        finalizeMessage(assistantId, acc, []);
      } else {
        // Aborted-with-nothing, or a real error: drop the exchange, restore input.
        if (!aborted) setError(e instanceof Error ? e.message : 'Something went wrong');
        setMessages((prev) => prev.filter((m) => m.id !== assistantId && m.id !== userMsg.id));
        setInput(trimmed);
      }
    } finally {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setLoading(false);
      setStreamingId(null);
      setStage(null);
      abortRef.current = null;
    }
  }, [
    loading, pillarsLoading, prefLoading, pillar, pillarList, getLabel,
    platform, postLength, useVoice, stableInitialMentions, messages,
    scheduleFlush, finalizeMessage,
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

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setInput('');
    setError('');
    try { sessionStorage.removeItem(CHAT_KEY); } catch {}
  }, []);

  function changeLength(next: PostLength) {
    setPostLength(next);
    void savePreferredPostLength(next);
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

        {messages.map((msg, idx) => {
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-ink px-4 py-2.5 text-[15px] leading-relaxed text-white">
                  {msg.content}
                </div>
              </div>
            );
          }

          const isStreaming = msg.id === streamingId;
          if (isStreaming) {
            return (
              <div key={msg.id} className="flex justify-start">
                <div className="w-full max-w-full space-y-2">
                  <div className="flex items-center gap-2 text-[12px] text-ink3">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {STAGE_LABELS[stage ?? 'thinking']}
                  </div>
                  {msg.content && (
                    <div className="rounded-2xl border border-hair bg-paper p-4 text-[15px] leading-relaxed text-ink whitespace-pre-wrap">
                      {msg.content}
                      <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-[3px] animate-pulse bg-ink" />
                    </div>
                  )}
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className="flex justify-start">
              {idx === lastAssistantIdx ? (
                <div className="w-full max-w-full">
                  <GenerateOutput
                    text={msg.content}
                    loading={false}
                    sourcePlatform={platform}
                    voiceMetrics={msg.voiceMetrics}
                    onTextUpdate={updateDraft}
                    variant="simple"
                    savePillar={pillar}
                  />
                </div>
              ) : (
                <div className="max-w-[90%] whitespace-pre-wrap rounded-2xl border border-hair bg-paper2 px-4 py-3 text-[14px] leading-relaxed text-ink2">
                  {msg.content}
                </div>
              )}
            </div>
          );
        })}

        {error && (
          <p className="text-center text-[13px] text-accent-primary">{error}</p>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="sticky bottom-0 rounded-2xl border border-hair bg-paper shadow-soft">
        <div className="flex flex-wrap items-center gap-2 border-b border-hair px-3 py-2 text-[12px]">
          <select
            value={pillar}
            onChange={(e) => setPillar(e.target.value)}
            disabled={pillarsLoading}
            aria-label="Content pillar"
            className="rounded-full border border-hair bg-paper2 px-2.5 py-1 text-ink2 focus:outline-none disabled:opacity-50"
          >
            {pillarList.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>

          <div className="flex items-center gap-1 rounded-full border border-hair bg-paper2 p-0.5">
            {DASHBOARD_PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlatform(p)}
                className={`rounded-full px-2.5 py-0.5 transition-colors ${
                  platform === p ? 'bg-ink text-white' : 'text-ink3 hover:text-ink2'
                }`}
              >
                {PLATFORM_LABELS[p]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 rounded-full border border-hair bg-paper2 p-0.5">
            {(Object.keys(POST_LENGTH_CONFIG) as PostLength[]).map((len) => (
              <button
                key={len}
                type="button"
                onClick={() => changeLength(len)}
                className={`rounded-full px-2.5 py-0.5 transition-colors ${
                  postLength === len ? 'bg-ink text-white' : 'text-ink3 hover:text-ink2'
                }`}
              >
                {POST_LENGTH_CONFIG[len].label}
              </button>
            ))}
          </div>

          {messages.length > 0 && (
            <button
              type="button"
              onClick={newChat}
              className="ml-auto flex items-center gap-1 rounded-full px-2.5 py-1 text-ink3 transition-colors hover:text-ink2"
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
          )}
        </div>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          autoFocus
          placeholder={lastDraft ? 'Ask for changes — shorter, punchier hook, add a CTA…' : 'What do you want to post about?'}
          className="w-full resize-none bg-transparent px-4 py-3 font-body text-[15px] leading-relaxed text-ink placeholder:text-ink3 focus:outline-none"
        />
        <div className="flex items-center justify-between border-t border-hair px-3 py-2">
          <MicDictate
            onText={(t) => setInput((cur) => (cur ? `${cur} ${t}` : t))}
            title="Dictate"
          />
          {loading ? (
            <button
              type="button"
              onClick={stopGeneration}
              aria-label="Stop"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white transition-opacity hover:opacity-90"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void sendMessage(input)}
              disabled={!input.trim() || pillarsLoading}
              aria-label="Send"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
