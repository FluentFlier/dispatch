'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Loader2, Sparkles, Target } from 'lucide-react';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import type { DirectorySettingsRow, IcpProfileRow } from '@/lib/signals/types';

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
    return 'Your ICP is saved. Tell me what to change - e.g. "focus on US only", "add healthcare", or "find leads now".';
  }
  return 'Who do you sell to? Describe your ideal customer - stage, industry, geography, signals like funding or YC batch. I will turn it into filters and can search for matching leads when you ask.';
}

interface IcpChatProps {
  settings: DirectorySettingsRow | null;
  onSettingsSaved?: (s: DirectorySettingsRow) => void;
  /** Fires when the assistant saved an ICP, so the Saved ICPs list stays live. */
  onProfilesChange?: (profiles: IcpProfileRow[]) => void;
  onDiscoveryComplete?: () => void;
  toast?: (message: string, type?: 'success' | 'error') => void;
  /** Tighter layout for the advanced drawer. */
  compact?: boolean;
}

/**
 * Conversational ICP setup - describe, refine, and trigger discovery in one thread.
 */
export function IcpChat({
  settings,
  onSettingsSaved,
  onProfilesChange,
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
  const [discovering, setDiscovering] = useState(false);
  // Live, profile-aware refinement chips (Google-autocomplete style). Replaces
  // the old hardcoded hints; regenerated as the user types or the ICP changes.
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const didMountRef = useRef(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      /* ignore */
    }
  }, [messages]);

  useEffect(() => {
    // Skip the mount run: the dashboard embeds this chat below the fold, and a
    // scrollIntoView for the initial greeting yanked the whole page down to the
    // outreach section on every load/logo-click. Only scroll once the user is
    // actually chatting.
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, loading]);

  // Debounced live suggestions: ask the small model for 3-4 refinement chips
  // based on the saved ICP + what the user is typing. Skips when there's nothing
  // to work with, aborts in-flight calls on change, and silently shows nothing
  // if the provider is down - suggestions are a nicety, never a blocker.
  const icpDescription = settings?.icp_description ?? '';
  useEffect(() => {
    const icp = icpDescription.trim();
    const draft = input.trim();
    // No early return on an empty first run: a brand-new workspace has neither
    // an ICP nor a draft, and that is exactly when starter chips help most. The
    // suggest route handles the empty case and returns openers.
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetchWithAuth('/api/leads/icp/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ current_icp: icp, draft }),
          signal: ctrl.signal,
        });
        const data = await res.json().catch(() => ({}));
        setSuggestions(Array.isArray(data.suggestions) ? (data.suggestions as string[]) : []);
      } catch {
        /* aborted or offline - leave existing chips as-is */
      }
    }, 500);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [input, icpDescription]);

  /**
   * Runs the real discovery: streams /api/leads/sync (the same endpoint the
   * Leads feed uses) and reports progress inline as an assistant message. This
   * is what actually finds leads - the chat route only classifies intent and
   * returns `suggestRun`; without this call "Find leads now" did nothing and the
   * assistant looped on "Hit Find leads now below".
   */
  const runDiscovery = useCallback(async () => {
    if (discovering) return;
    setDiscovering(true);
    const statusId = newId();
    setMessages((prev) => [
      ...prev,
      { id: statusId, role: 'assistant', content: 'Searching for matching leads…' },
    ]);
    const patch = (content: string) =>
      setMessages((prev) => prev.map((m) => (m.id === statusId ? { ...m, content } : m)));

    try {
      const res = await fetchWithAuth('/api/leads/sync', { method: 'POST' });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === 'string' ? data.error : 'Search failed.');
      }

      // Consume the NDJSON progress stream: {type:'progress',pct,label} then a
      // terminal {type:'result'} or {type:'error'}.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      type ScrapeResult = { inserted: number; updated: number; resolved: number; warnings?: string[] };
      let result: ScrapeResult | null = null;
      let streamError: string | null = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(t);
          } catch {
            continue;
          }
          if (msg.type === 'progress') {
            const label = typeof msg.label === 'string' ? msg.label : 'Working…';
            const pct = typeof msg.pct === 'number' ? msg.pct : null;
            patch(pct !== null ? `Searching… ${label} (${pct}%)` : `Searching… ${label}`);
          } else if (msg.type === 'result') {
            result = msg.result as ScrapeResult;
          } else if (msg.type === 'error') {
            streamError = typeof msg.error === 'string' ? msg.error : 'Search failed.';
          }
        }
      }

      if (streamError) throw new Error(streamError);
      const inserted = result?.inserted ?? 0;
      const warnings = result?.warnings ?? [];
      if (inserted === 0 && warnings.length > 0) {
        patch(`No new leads this time - ${warnings[0]}`);
        toast?.(`0 new leads - ${warnings[0]}`, 'error');
      } else {
        patch(
          inserted > 0
            ? `Found ${inserted} new lead${inserted === 1 ? '' : 's'}. Opening your feed…`
            : 'Search ran - no new leads matched right now.',
        );
        toast?.(
          inserted > 0 ? `Found ${inserted} new leads.` : 'Search ran - no new leads matched.',
          'success',
        );
      }
      onDiscoveryComplete?.();
    } catch (err) {
      const m = err instanceof Error ? err.message : 'Search failed.';
      patch(`Couldn't finish the search: ${m}`);
      toast?.(m, 'error');
    } finally {
      setDiscovering(false);
    }
  }, [discovering, onDiscoveryComplete, toast]);

  const send = useCallback(async (override?: string) => {
    const trimmed = (override ?? input).trim();
    if (!trimmed || loading) return;

    const userMsg: IcpChatMessage = { id: newId(), role: 'user', content: trimmed };
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetchWithAuth('/api/leads/icp/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, history }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Chat failed');

      // When discovery is about to run, runDiscovery() posts its own status
      // message - skip the route's CTA line so we don't stack two messages.
      if (!data.suggestRun) {
        setMessages((prev) => [
          ...prev,
          { id: newId(), role: 'assistant', content: data.assistantMessage as string },
        ]);
      }

      if (data.settings) onSettingsSaved?.(data.settings as DirectorySettingsRow);
      // The route now mirrors an applied ICP into the Saved ICPs list, so push
      // the fresh list up instead of leaving that card stale until a reload.
      if (Array.isArray(data.profiles)) onProfilesChange?.(data.profiles as IcpProfileRow[]);
      if (data.applied) toast?.('ICP updated.', 'success');
      if (data.suggestRun) void runDiscovery();
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
      inputRef.current?.focus();
    }
  }, [input, loading, messages, onProfilesChange, onSettingsSaved, runDiscovery, toast]);

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

      <div className={`flex-1 overflow-y-auto px-4 py-3 space-y-3 ${compact ? 'max-h-[240px]' : 'max-h-[320px]'}`}>
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
        <div ref={bottomRef} />
      </div>

      <div className="px-4 pb-2">
        <p className="text-[11px] text-text-tertiary border-l-2 border-accent-primary/30 pl-2">
          Tell it who you sell to or who to watch, and it sets up your lead filters and alerts.
        </p>
      </div>

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
        {/* Live, profile-aware refinement chips. Clicking one sends it straight
            to the assistant: the chip already reads as a complete instruction,
            and the old fill-the-box behaviour looked broken (click, nothing
            happens, user has to press enter on text they did not type). */}
        {suggestions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                disabled={loading || discovering}
                onClick={() => void send(s)}
                className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border border-border text-text-tertiary hover:text-text-primary hover:border-accent-primary/30 disabled:opacity-50"
              >
                <Sparkles className="h-3 w-3" />
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
