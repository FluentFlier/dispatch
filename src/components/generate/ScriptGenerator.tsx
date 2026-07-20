'use client';

import { useEffect, useState, useRef, useCallback, type KeyboardEvent, type ChangeEvent, type DragEvent, useMemo } from 'react';
import { ArrowUp, Loader2, Square, Plus, AudioLines, Send, Check, History, Trash2, Paperclip, X } from 'lucide-react';
import { MicDictate } from './MicDictate';
import { assembleGeneratePrompt } from '@/lib/generate-prompt';
import { GenerateOutput, type GenerateVoiceMetrics } from './GenerateOutput';
import { LinkedInComposer } from './LinkedInComposer';
import { usePillars } from '@/hooks/usePillars';
import { resolvePillarBrief } from '@/lib/pillars/briefs';
import { DASHBOARD_PLATFORMS, PLATFORM_LABELS, type DashboardPlatform } from '@/lib/constants';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { SessionSidebar, type WriteTool } from './SessionSidebar';
import type { ChatSummary } from '@/lib/chats-status';
import { useCreatorPreferences, POST_LENGTH_CONFIG, type PostLength } from '@/hooks/useCreatorPreferences';
import {
  extractTagMentions,
  mergeMentions,
} from '@/lib/mentions';

// Pillar briefs describe the GOAL and the beats to hit as NARRATIVE guidance,
// never as a labeled one-line-per-beat skeleton. The old "HOOK: one sentence /
// SETUP: 2 bullets" format forced broetry (single-sentence paragraphs) that
// reads as generic AI slop and fights the pipeline's paragraph_shape rule. These
// ask for flowing paragraphs instead, so the draft sounds like a person wrote it.

type MessageCompleteness = { starved?: boolean; voiceSource?: string } | null;

type ChatMessage =
  | { id: string; role: 'user'; content: string }
  | {
      id: string;
      role: 'assistant';
      content: string;
      voiceMetrics?: GenerateVoiceMetrics;
      completeness?: MessageCompleteness;
      status?: 'queued' | 'running' | 'done' | 'error' | 'canceled';
      stage?: GenStage | null;
      error?: string;
      contextId?: string | null;
    };

type GenStage = 'thinking' | 'writing' | 'revising' | 'polishing' | 'scoring';

const STAGE_LABELS: Record<GenStage, string> = {
  thinking: 'Thinking through the angle…',
  writing: 'Writing your draft…',
  revising: 'Reworking the draft…',
  polishing: 'Polishing out the AI tells…',
  scoring: 'Scoring voice match…',
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

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildFirstDraftBase(
  pillar: string,
  pillarLabel: string,
  platform: DashboardPlatform | null,
  promptTemplate?: string,
): string {
  const brief = resolvePillarBrief(pillar, promptTemplate);
  if (brief) return brief;
  if (platform === 'linkedin') {
    return `Write a LinkedIn post in the creator's voice only, 200-350 words, no em dashes. Open with one strong first line that earns the read, give the context or stakes, then a specific story or real detail, land a genuine takeaway, and close with one direct question. Write it as real flowing paragraphs (2-4 sentences each), never a stack of one-line fragments or labeled beats.`;
  }
  if (platform === null) {
    return `Write a short post in the creator's voice only, no em dashes. Open with one bold first line, carry a single clear idea through a few sentences of real substance, and close with one direct question. Flowing sentences, not labeled one-line beats.`;
  }
  return `Write a ${platform} post in the creator's voice only, tight enough to say in under 60 seconds, no em dashes. Open with one bold first line, carry a single clear idea with real substance, and close with one direct question. Flowing sentences, not labeled one-line beats.`;
}

interface ScriptGeneratorProps {
  initialResult?: string;
  initialTopic?: string;
  initialPillar?: string;
  initialPlatform?: DashboardPlatform;
  initialMentions?: string[];
  autoGenerate?: boolean;
  /** Secondary Write tools, rendered as a "More tools" dropdown in the sidebar. */
  secondaryTools?: WriteTool[];
  onSelectTool?: (id: string) => void;
}

const PLATFORM_OPTIONS: (DashboardPlatform | null)[] = [null, ...DASHBOARD_PLATFORMS];

const CHAT_KEY = 'generate:script:chat';
const CHAT_ID_KEY = 'generate:script:chat-id';
const SIDEBAR_COLLAPSED_KEY = 'generate:script:sidebar-collapsed';

function formatChatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
      ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function ScriptGenerator({
  initialResult = '',
  initialTopic = '',
  initialPillar = '',
  initialPlatform,
  initialMentions = [],
  autoGenerate = false,
  secondaryTools = [],
  onSelectTool,
}: ScriptGeneratorProps) {
  const mentionSeed = initialMentions.join(',');
  const stableInitialMentions = useMemo(
    () => mergeMentions(initialMentions),
    [mentionSeed, initialMentions],
  );
  const { pillars: pillarList, loading: pillarsLoading, getLabel } = usePillars();
  const { preferredPostLength, voiceEnabled, loading: prefLoading, savePreferredPostLength, saveVoiceEnabled } = useCreatorPreferences();

  const [pillar, setPillar] = useState(initialPillar);
  const [input, setInput] = useState('');
  const [platform, setPlatform] = useState<DashboardPlatform | null>(initialPlatform ?? 'linkedin');
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
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ChatSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  const [conversationId, setConversationId] = useState<string | null>(() => {
    try { return sessionStorage.getItem(CHAT_ID_KEY); } catch { return null; }
  });
  const [stage, setStage] = useState<GenStage | null>(null);
  const [error, setError] = useState('');
  const [attachments, setAttachments] = useState<{ id: string; name: string; text: string }[]>([]);
  const [attaching, setAttaching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const autoGenTriggered = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Generation-context bundle id for this thread. The server returns it on each
  // draft; we echo it back on revises so regens reuse the cached context and the
  // server can track the light-regen budget. Reset on new/loaded chats.
  const contextIdRef = useRef<string | null>(null);

  const lastDraft = [...messages].reverse().find((m) => m.role === 'assistant' && m.content.trim())?.content ?? '';
  const lastAssistantIdx = messages.findLastIndex((m) => m.role === 'assistant');
  const activeAssistant = [...messages].reverse().find(
    (m): m is Extract<ChatMessage, { role: 'assistant' }> =>
      m.role === 'assistant' && (m.status === 'queued' || m.status === 'running'),
  );
  const isGenerating = Boolean(activeAssistant);

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
    if (isGenerating) return;
    try { sessionStorage.setItem(CHAT_KEY, JSON.stringify(messages)); } catch {}
  }, [messages, isGenerating]);

  // Server-side history: sync the conversation after each completed exchange
  // (debounced, best-effort - sessionStorage above is the immediate fallback).
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isGenerating) return;
    if (!messages.some((m) => m.role === 'assistant' && m.content.trim())) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    const snapshot = messages;
    syncTimerRef.current = setTimeout(() => {
      void (async () => {
        try {
          if (conversationIdRef.current) {
            await fetchWithAuth(`/api/chats/${conversationIdRef.current}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ messages: snapshot }),
            });
          }
        } catch {
          // History sync is best-effort; the chat stays in sessionStorage.
        }
      })();
    }, 800);
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [messages, isGenerating]);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetchWithAuth('/api/chats', { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        setHistory(Array.isArray(data?.chats) ? (data.chats as ChatSummary[]) : []);
      }
    } catch {
      // leave whatever list we had
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (historyOpen) void refreshHistory();
  }, [historyOpen, refreshHistory]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);

  // Populate the sidebar on mount, then poll the list only while a session is
  // still generating so running badges clear when background jobs finish.
  const anyRunning = history.some((c) => c.status === 'running');
  useEffect(() => { void refreshHistory(); }, [refreshHistory]);
  useEffect(() => {
    if (!anyRunning) return;
    const t = window.setInterval(() => void refreshHistory(), 4000);
    return () => window.clearInterval(t);
  }, [anyRunning, refreshHistory]);

  const openHistory = useCallback(() => {
    setHistoryOpen((open) => !open);
  }, []);

  useEffect(() => {
    const latestContext = [...messages]
      .reverse()
      .find((m): m is Extract<ChatMessage, { role: 'assistant' }> => m.role === 'assistant' && Boolean(m.contextId))
      ?.contextId;
    if (latestContext) contextIdRef.current = latestContext;
  }, [messages]);

  const loadConversation = useCallback(async (id: string) => {
    setHistoryOpen(false);
    try {
      const res = await fetchWithAuth(`/api/chats/${id}`, { method: 'GET' });
      if (!res.ok) return;
      const data = await res.json();
      const chat = data?.chat;
      if (!chat || !Array.isArray(chat.messages)) return;
      const loadedMessages = chat.messages as ChatMessage[];
      contextIdRef.current =
        [...loadedMessages]
          .reverse()
          .find((m): m is Extract<ChatMessage, { role: 'assistant' }> => m.role === 'assistant' && Boolean(m.contextId))
          ?.contextId ?? null;
      setMessages(chat.messages as ChatMessage[]);
      setConversationId(id);
      if (isPlatform(chat.platform)) setPlatform(chat.platform);
      if (typeof chat.pillar === 'string' && chat.pillar) setPillar(chat.pillar);
      setInput('');
      setError('');
      try {
        sessionStorage.setItem(CHAT_ID_KEY, id);
        sessionStorage.setItem(CHAT_KEY, JSON.stringify(chat.messages));
      } catch {}
    } catch {
      // load is best-effort; current chat stays untouched
    }
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    setHistory((prev) => prev.filter((c) => c.id !== id));
    if (conversationIdRef.current === id) {
      setConversationId(null);
      try { sessionStorage.removeItem(CHAT_ID_KEY); } catch {}
    }
    try {
      await fetchWithAuth(`/api/chats/${id}`, { method: 'DELETE' });
    } catch {
      // best-effort; row stays server-side and reappears on next open
    }
  }, []);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) =>
      /\.(txt|md|pdf)$/i.test(f.name) || f.type === 'application/pdf' || f.type.startsWith('text/'),
    );
    if (files.length === 0) return;
    setAttaching(true);
    for (const file of files) {
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetchWithAuth('/api/generate/parse-file', { method: 'POST', body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setError((data as { error?: string }).error ?? `Couldn't read ${file.name}`); continue; }
        setAttachments((prev) => [...prev, { id: newId(), name: (data.name as string) ?? file.name, text: (data.text as string) ?? '' }]);
      } catch {
        setError(`Couldn't read ${file.name}`);
      }
    }
    setAttaching(false);
  }, []);

  function onFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) void handleFiles(e.target.files);
    e.target.value = '';
  }

  function onComposerDrop(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.files?.length) return;
    e.preventDefault();
    void handleFiles(e.dataTransfer.files);
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  // Scroll only the chat pane - scrollIntoView would also move ancestor
  // containers and jump the whole page down to the latest draft.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading || isGenerating || pillarsLoading || prefLoading || !pillar) return;

    const priorDraft = [...messages].reverse().find((m) => m.role === 'assistant' && m.content.trim())?.content;
    const info = pillarList.find((p) => p.value === pillar);
    const pillarLabel = info?.label ?? getLabel(pillar);
    const mode: 'draft' | 'revise' = priorDraft ? 'revise' : 'draft';

    const attachmentBlock = attachments.length
      ? `\n\nATTACHED FILE CONTEXT:\n${attachments.map((a) => `[${a.name}]\n${a.text}`).join('\n\n')}`
      : '';

    let assembled: string;
    if (priorDraft) {
      assembled = assembleGeneratePrompt({
        base: `Revise this${platform ? ` ${platform}` : ''} post based on the creator's latest message. Return ONLY the updated post - no commentary, no labels.`,
        thoughts: `CURRENT DRAFT:\n${priorDraft}\n\nCREATOR SAID:\n${trimmed}${attachmentBlock}`,
        lengthHint: POST_LENGTH_CONFIG[postLength].hint,
      });
    } else {
      const base = buildFirstDraftBase(pillar, pillarLabel, platform, info?.promptTemplate);
      assembled = assembleGeneratePrompt({
        base,
        thoughts: `${trimmed}${attachmentBlock}`,
        lengthHint: POST_LENGTH_CONFIG[postLength].hint,
      });
    }
    const mentions = mergeMentions(stableInitialMentions, extractTagMentions(trimmed));

    const userMsg: ChatMessage = { id: newId(), role: 'user', content: trimmed };
    const assistantId = newId();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      status: 'queued',
      stage: mode === 'revise' ? 'revising' : 'thinking',
    };
    const optimisticMessages = [...messages, userMsg, assistantMsg];
    setMessages(optimisticMessages);
    setInput('');
    setAttachments([]);
    setError('');
    setLoading(true);
    setStage(mode === 'revise' ? 'revising' : 'thinking');

    try {
      const res = await fetchWithAuth('/api/generate/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversationIdRef.current,
          userMessage: { id: userMsg.id, content: trimmed },
          assistantId,
          prompt: assembled,
          topic: assembled.slice(0, 200),
          platform,
          pillar,
          useVoice,
          mode,
          ...(mentions.length > 0 ? { mentions } : {}),
          ...(mode === 'revise' && contextIdRef.current ? { context_id: contextIdRef.current } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Generation failed');
      const id = (data as { conversationId?: string }).conversationId;
      if (id) {
        setConversationId(id);
        try { sessionStorage.setItem(CHAT_ID_KEY, id); } catch {}
      }
      if (Array.isArray((data as { messages?: unknown }).messages)) {
        setMessages((data as { messages: ChatMessage[] }).messages);
      }
      void refreshHistory();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setMessages((prev) => prev.filter((m) => m.id !== assistantId && m.id !== userMsg.id));
      setInput(trimmed);
    } finally {
      setLoading(false);
      setStage(null);
    }
  }, [
    loading, isGenerating, pillarsLoading, prefLoading, pillar, pillarList, getLabel,
    platform, postLength, useVoice, stableInitialMentions, messages, attachments,
    refreshHistory,
  ]);

  useEffect(() => {
    if (!conversationId || !activeAssistant) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetchWithAuth(`/api/chats/${conversationId}`, { method: 'GET' });
        if (!res.ok) return;
        const data = await res.json();
        const chat = data?.chat;
        if (cancelled || !chat || !Array.isArray(chat.messages)) return;
        const nextMessages = chat.messages as ChatMessage[];
        setMessages(nextMessages);
        const currentAssistant = nextMessages.find(
          (m): m is Extract<ChatMessage, { role: 'assistant' }> => m.id === activeAssistant.id && m.role === 'assistant',
        );
        setStage(currentAssistant?.stage ?? null);
        try {
          sessionStorage.setItem(CHAT_KEY, JSON.stringify(nextMessages));
        } catch {}
      } catch {
        // A missed poll is harmless; the next tick will catch up.
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 1600);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // Key on the job id, not the activeAssistant object: each poll replaces the
    // message array with fresh objects, so depending on the object would tear
    // down and restart this effect every tick, polling back-to-back instead of
    // on the interval.
  }, [conversationId, activeAssistant?.id]);

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

  const newChat = useCallback(() => {
    setMessages([]);
    setInput('');
    setError('');
    setConversationId(null);
    contextIdRef.current = null;
    try {
      sessionStorage.removeItem(CHAT_KEY);
      sessionStorage.removeItem(CHAT_ID_KEY);
    } catch {}
  }, []);

  const stopGeneration = useCallback(() => {
    const assistantId = activeAssistant?.id;
    if (!assistantId) return;
    setLoading(false);
    setStage(null);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId && m.role === 'assistant'
          ? { ...m, status: 'canceled', error: 'Generation stopped.' }
          : m,
      ),
    );
  }, [activeAssistant?.id]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    const next = Math.min(el.scrollHeight, 176);
    el.style.height = `${Math.max(next, 44)}px`;
    el.style.overflowY = el.scrollHeight > 176 ? 'auto' : 'hidden';
  }, [input]);

  function changeLength(next: PostLength) {
    setPostLength(next);
    void savePreferredPostLength(next);
  }

  function toggleVoice() {
    setUseVoice((prev) => {
      const next = !prev;
      void saveVoiceEnabled(next);
      return next;
    });
  }

  const platformLabel = platform ? PLATFORM_LABELS[platform] : 'any platform';
  const isEmpty = messages.length === 0 && !loading;

  return (
    <div className="relative flex min-h-[calc(100vh-10rem)] gap-8">
      {/* Main column grows to fill; its content stays centered at a readable
          width so the sidebar can sit flush on the right. */}
      <div className="flex min-w-0 flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
      {/* scrollbar-gutter:stable reserves the scrollbar track even when empty, so
          the centered hero does not shift a few px left the moment the thread
          starts to overflow while the composer below (outside this scroller)
          stays put. Without it the two centres drift apart. */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pb-4 [scrollbar-gutter:stable]">
        {isEmpty && (
          <div className="py-12 text-center">
            <h1 className="font-serif text-[1.75rem] font-normal tracking-[-0.03em] text-ink sm:text-[2rem]">
              What are we creating today?
            </h1>
            <p className="mt-2 text-sm text-ink3">
              Tell me the idea - I&apos;ll draft it in your voice for {platformLabel}.
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

          const isRunning = msg.role === 'assistant' && (msg.status === 'queued' || msg.status === 'running');
          if (isRunning) {
            return (
              <div key={msg.id} className="flex justify-start">
                <div className="w-full max-w-full space-y-2">
                  <div className="flex items-center gap-2 text-[12px] text-ink3">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {STAGE_LABELS[msg.stage ?? stage ?? 'thinking']}
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

          if (msg.role === 'assistant' && msg.status === 'error') {
            return (
              <div key={msg.id} className="flex justify-start">
                <div className="max-w-[90%] rounded-2xl border border-flame/30 bg-flame/5 px-4 py-3 text-[14px] leading-relaxed text-flame">
                  {msg.error || 'Generation failed.'}
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
                    sourcePlatform={platform ?? undefined}
                    voiceMetrics={msg.voiceMetrics}
                    completeness={msg.completeness}
                    onTextUpdate={updateDraft}
                    variant="simple"
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

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onComposerDrop}
        className="sticky bottom-0 rounded-2xl border border-hair bg-paper shadow-soft transition-shadow focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-light)]"
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            {attachments.map((a) => (
              <span key={a.id} className="inline-flex items-center gap-1 rounded-full border border-hair bg-paper2 px-2.5 py-1 text-[12px] text-ink2">
                {a.name}
                <button type="button" onClick={() => removeAttachment(a.id)} aria-label={`Remove ${a.name}`} className="text-ink3 hover:text-ink">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          autoFocus
          placeholder={lastDraft ? 'Ask for changes - shorter, punchier hook, add a CTA…' : 'What do you want to post about?'}
          className="w-full resize-none bg-transparent px-4 py-3 font-body text-[15px] leading-relaxed text-ink placeholder:text-ink3 focus:outline-none focus:shadow-none focus:border-transparent"
        />
        <div className="flex items-center justify-between border-t border-hair px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            {/* ChatGPT-style "+" menu: per-draft voice toggle + publish. */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setPlusMenuOpen((o) => !o)}
                aria-label="More options"
                aria-expanded={plusMenuOpen}
                className="flex h-9 w-9 items-center justify-center rounded-full text-ink3 transition-colors hover:bg-paper2 hover:text-ink2"
              >
                <Plus className="h-4 w-4" />
              </button>
              {plusMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setPlusMenuOpen(false)} />
                  <div className="absolute bottom-11 left-0 z-20 w-64 overflow-hidden rounded-xl border border-hair bg-paper py-1 shadow-soft">
                    <button
                      type="button"
                      onClick={() => { toggleVoice(); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink2 transition-colors hover:bg-paper2"
                    >
                      <AudioLines className="h-4 w-4 text-ink3" />
                      <span className="flex-1">Voice</span>
                      <span className={`text-[11px] font-medium ${useVoice ? 'text-ink' : 'text-ink3'}`}>
                        {useVoice ? 'On' : 'Off'}
                      </span>
                      {useVoice && <Check className="h-3.5 w-3.5 text-ink" />}
                    </button>

                    <div className="px-3 py-2">
                      <p className="mb-1.5 text-[11px] font-medium text-ink3">Platform</p>
                      <div className="flex items-center gap-1 rounded-full border border-hair bg-paper2 p-0.5">
                        {PLATFORM_OPTIONS.map((p) => (
                          <button
                            key={p ?? 'none'}
                            type="button"
                            onClick={() => setPlatform(p)}
                            className={`flex-1 rounded-full px-2 py-1 text-[12px] transition-colors ${
                              platform === p ? 'bg-ink text-white' : 'text-ink3 hover:text-ink2'
                            }`}
                          >
                            {p ? PLATFORM_LABELS[p] : 'None'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="px-3 py-2">
                      <p className="mb-1.5 text-[11px] font-medium text-ink3">Length</p>
                      <div className="flex items-center gap-1 rounded-full border border-hair bg-paper2 p-0.5">
                        {(Object.keys(POST_LENGTH_CONFIG) as PostLength[]).map((len) => (
                          <button
                            key={len}
                            type="button"
                            onClick={() => changeLength(len)}
                            className={`flex-1 rounded-full px-2 py-1 text-[12px] transition-colors ${
                              postLength === len ? 'bg-ink text-white' : 'text-ink3 hover:text-ink2'
                            }`}
                          >
                            {POST_LENGTH_CONFIG[len].label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => { setPlusMenuOpen(false); setPublishOpen(true); }}
                      disabled={!lastDraft.trim() || !platform}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink2 transition-colors hover:bg-paper2 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Send className="h-4 w-4 text-ink3" />
                      <span className="flex-1">
                        Publish{!lastDraft.trim() ? ' (draft first)' : !platform ? ' (pick a platform)' : ''}
                      </span>
                    </button>
                  </div>
                </>
              )}
            </div>
            <MicDictate
              onText={(t) => setInput((cur) => (cur ? `${cur} ${t}` : t))}
              title="Dictate"
            />

            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
              multiple
              hidden
              onChange={onFileInputChange}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={attaching}
              aria-label="Attach file"
              title="Attach a text file or PDF"
              className="flex h-9 w-9 items-center justify-center rounded-full text-ink3 transition-colors hover:bg-paper2 hover:text-ink2 disabled:opacity-50"
            >
              {attaching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
            </button>

            <div className="relative flex items-center gap-1 lg:hidden">
              <button
                type="button"
                onClick={() => void openHistory()}
                aria-label="Chat history"
                aria-expanded={historyOpen}
                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-ink3 transition-colors hover:text-ink2"
              >
                <History className="h-3.5 w-3.5" />
                History
              </button>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={newChat}
                  className="flex items-center gap-1 rounded-full px-2.5 py-1 text-ink3 transition-colors hover:text-ink2"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New
                </button>
              )}
              {historyOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setHistoryOpen(false)} />
                  <div className="absolute bottom-11 left-0 z-20 max-h-80 w-72 overflow-y-auto rounded-xl border border-hair bg-paper py-1 shadow-soft">
                    {historyLoading && (
                      <div className="flex items-center gap-2 px-3 py-2 text-[13px] text-ink3">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                      </div>
                    )}
                    {!historyLoading && history.length === 0 && (
                      <p className="px-3 py-2 text-[13px] text-ink3">No saved chats yet.</p>
                    )}
                    {history.map((chat) => (
                      <div
                        key={chat.id}
                        className={`group flex items-center gap-2 px-3 py-2 transition-colors hover:bg-paper2 ${
                          chat.id === conversationId ? 'bg-paper2' : ''
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => void loadConversation(chat.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="block truncate text-[13px] text-ink2">{chat.title}</span>
                          <span className="text-[11px] text-ink3">{formatChatDate(chat.updated_at)}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteConversation(chat.id)}
                          aria-label={`Delete "${chat.title}"`}
                          className="hidden rounded p-1 text-ink3 transition-colors hover:text-accent-primary group-hover:block"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
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
      </div>
      <SessionSidebar
        chats={history}
        activeId={conversationId}
        collapsed={sidebarCollapsed}
        loading={historyLoading}
        onSelect={(id) => void loadConversation(id)}
        onNew={newChat}
        onDelete={(id) => void deleteConversation(id)}
        onToggleCollapsed={toggleSidebar}
        tools={secondaryTools}
        onSelectTool={(id) => onSelectTool?.(id)}
      />
      <LinkedInComposer
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        initialText={lastDraft}
        platform={platform ?? 'linkedin'}
      />
    </div>
  );
}
