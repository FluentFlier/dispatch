'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Loader2, Sparkles, Target } from 'lucide-react';
import type { DirectorySettingsRow } from '@/lib/signals/types';

export interface IcpChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const STORAGE_KEY = 'leads:icp:chat';

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function welcomeMessage(hasIcp: boolean): string {
  if (hasIcp) {
    return 'Your ICP is saved. Tell me what to change — e.g. "focus on US only", "add healthcare", or "find leads now".';
  }
  return 'Who do you sell to? Describe your ideal customer — stage, industry, geography, signals like funding or YC batch. I will turn it into filters and can search for matching leads when you ask.';
}

interface IcpChatProps {
  settings: DirectorySettingsRow | null;
  onSettingsSaved?: (s: DirectorySettingsRow) => void;
  onDiscoveryComplete?: () => void;
  toast?: (message: string, type?: 'success' | 'error') => void;
  /** Tighter layout for the advanced drawer. */
  compact?: boolean;
}

/**
 * Conversational ICP setup — describe, refine, and trigger discovery in one thread.
 */
export function IcpChat({
  settings,
  onSettingsSaved,
  onDiscoveryComplete,
  toast,
  compact = false,
}: IcpChatProps) {
  const hasIcp = Boolean(
    settings?.icp_description?.trim() ||
      (settings?.icp_verticals?.length ?? 0) > 0 ||
      (settings?.icp_keywords?.length ?? 0) > 0,
  );

  const [messages, setMessages] = useState<IcpChatMessage[]>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as IcpChatMessage[];
        if (saved.length > 0) return saved;
      }
    } catch {
      /* ignore */
    }
    return [{ id: newId(), role: 'assistant', content: welcomeMessage(hasIcp) }];
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const skipInitialScroll = useRef(true);
  // Set when the user sends, so their message always scrolls into view even if
  // they'd scrolled up; cleared once the pane has been pinned to the bottom.
  const forceScroll = useRef(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      /* ignore */
    }
  }, [messages]);

  // Keep the chat pane pinned to the newest message — but only the pane, never
  // the page (scrollIntoView / focus() would move the whole page), and only
  // when the user is already near the bottom so we don't yank them off history.
  useEffect(() => {
    if (skipInitialScroll.current) {
      skipInitialScroll.current = false;
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (!forceScroll.current && !nearBottom) return;
    forceScroll.current = false;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMsg: IcpChatMessage = { id: newId(), role: 'user', content: trimmed };
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    forceScroll.current = true;
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/leads/icp/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, history }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Chat failed');

      setMessages((prev) => [
        ...prev,
        { id: newId(), role: 'assistant', content: data.assistantMessage as string },
      ]);

      if (data.settings) onSettingsSaved?.(data.settings as DirectorySettingsRow);

      if (data.applied) {
        const inserted = (data.sync as { inserted?: number } | null)?.inserted ?? 0;
        if (data.discoveryRan) {
          toast?.(
            inserted > 0 ? `ICP updated — ${inserted} new leads found.` : 'ICP updated — discovery ran.',
            'success',
          );
          onDiscoveryComplete?.();
        } else {
          toast?.('ICP updated.', 'success');
        }
      } else if (data.discoveryRan) {
        const inserted = (data.sync as { inserted?: number } | null)?.inserted ?? 0;
        toast?.(
          inserted > 0 ? `Found ${inserted} new leads.` : 'Discovery ran with your current ICP.',
          'success',
        );
        onDiscoveryComplete?.();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not send message.';
      toast?.(msg, 'error');
      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: 'assistant',
          content: 'Something went wrong on my side. Try again in a moment.',
        },
      ]);
    } finally {
      setLoading(false);
      // preventScroll: refocusing the textarea must not scroll the whole page
      // (the chat lives inside taller surfaces — leads setup, the GTM drawer).
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [input, loading, messages, onDiscoveryComplete, onSettingsSaved, toast]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const verticals = settings?.icp_verticals ?? [];
  const keywords = settings?.icp_keywords ?? [];

  return (
    <section
      className={`rounded-lg border border-border bg-bg-secondary flex flex-col ${
        compact ? 'min-h-[320px]' : 'min-h-[420px]'
      }`}
    >
      <div className="border-b border-border px-4 py-3 flex items-start gap-3">
        <div className="rounded-full bg-accent-primary/10 p-2 shrink-0">
          <Target className="h-4 w-4 text-accent-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-text-primary">ICP assistant</h2>
          <p className="text-xs text-text-secondary mt-0.5">
            Describe who you sell to or ask for changes. Say &quot;find leads&quot; when ready to search.
          </p>
          {(verticals.length > 0 || keywords.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {verticals.map((v) => (
                <span
                  key={`v-${v}`}
                  className="inline-flex rounded-full border border-border bg-bg-primary px-2 py-0.5 text-[10px] text-text-secondary"
                >
                  {v}
                </span>
              ))}
              {keywords.slice(0, 8).map((k) => (
                <span
                  key={`k-${k}`}
                  className="inline-flex rounded-full border border-accent-primary/20 bg-accent-primary/5 px-2 py-0.5 text-[10px] text-accent-primary"
                >
                  {k}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className={`flex-1 overflow-y-auto px-4 py-3 space-y-3 ${compact ? 'max-h-[240px]' : 'max-h-[320px]'}`}
      >
        {messages.map((msg) =>
          msg.role === 'user' ? (
            <div key={msg.id} className="flex justify-end">
              <div className="max-w-[88%] rounded-2xl bg-accent-primary px-3 py-2 text-sm text-white leading-relaxed">
                {msg.content}
              </div>
            </div>
          ) : (
            <div key={msg.id} className="flex justify-start">
              <div className="max-w-[92%] rounded-2xl border border-border bg-bg-primary px-3 py-2 text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
                {msg.content}
              </div>
            </div>
          ),
        )}
        {loading && (
          <div className="flex justify-start">
            <div className="inline-flex items-center gap-2 rounded-2xl border border-border bg-bg-primary px-3 py-2 text-xs text-text-tertiary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Updating ICP…
            </div>
          </div>
        )}
      </div>

      {settings?.icp_description?.trim() && (
        <div className="px-4 pb-2">
          <p className="text-[11px] text-text-tertiary line-clamp-2 border-l-2 border-accent-primary/30 pl-2">
            {settings.icp_description}
          </p>
        </div>
      )}

      <div className="border-t border-border p-3">
        <div className="flex gap-2 items-end rounded-xl border border-border bg-bg-primary px-3 py-2 focus-within:ring-2 focus-within:ring-accent-primary/30">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={compact ? 1 : 2}
            placeholder="Seed-stage fintech from YC… or: add healthcare, find leads now"
            className="flex-1 resize-none bg-transparent text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none min-h-[40px] max-h-[120px]"
            disabled={loading}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={loading || !input.trim()}
            aria-label="Send"
            className="shrink-0 rounded-full bg-accent-primary p-2 text-white disabled:opacity-40 hover:bg-accent-primary/90 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            'Seed B2B SaaS, recently raised',
            'Narrow to US fintech only',
            'Find leads now',
          ].map((hint) => (
            <button
              key={hint}
              type="button"
              disabled={loading}
              onClick={() => setInput(hint)}
              className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border border-border text-text-tertiary hover:text-text-primary hover:border-accent-primary/30 disabled:opacity-50"
            >
              {hint.includes('Find') && <Sparkles className="h-3 w-3" />}
              {hint}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
