'use client';

import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import {
  AtSign, ChevronDown, Clock, Globe2, Image as ImageIcon, Link2, Loader2, Plus, Send, Sparkles, Trash2, X,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { CharCount } from '@/components/ui/CharCount';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { formatRelative } from '@/lib/utils';
import { getInitials, normalizeUrl } from '@/lib/compose-preview';
import { LinkedInComposer } from '@/components/generate/LinkedInComposer';
import { XLogo, LinkedInLogo, InstagramLogo, ThreadsLogo } from '@/components/ui/BrandIcons';
import { PLATFORM_LABELS, type Platform } from '@/lib/constants';
import type { VoiceEvaluationMatrix } from '@/lib/voice-evaluator';
import type { PostMention } from '@/lib/social/types';

interface PostRow {
  id: string;
  title: string;
  script: string | null;
  caption: string | null;
  platform: string;
  status: string;
  updated_at: string;
  scheduled_publish_at: string | null;
  image_url: string | null;
  mentions: PostMention[] | null;
}

interface MentionSuggestion {
  id: string;
  name: string;
  headline?: string;
}

/** Toggle row order mirrors the reference design: X first, LinkedIn hero. */
const PLATFORM_TOGGLES: { id: Platform; icon: ComponentType<{ className?: string }> }[] = [
  { id: 'twitter', icon: XLogo },
  { id: 'instagram', icon: InstagramLogo },
  { id: 'linkedin', icon: LinkedInLogo },
  { id: 'threads', icon: ThreadsLogo },
];

/** Platforms the publish pipeline actually supports today (Unipile). */
const ENABLED_PLATFORMS = new Set<Platform>(['twitter', 'linkedin']);

function isPlatform(value: string): value is Platform {
  return value === 'twitter' || value === 'linkedin' || value === 'instagram' || value === 'threads';
}

function draftTitle(text: string): string {
  return text.trim().split('\n')[0]?.slice(0, 80) || 'Untitled draft';
}

const REVIEW_ROWS: { key: keyof VoiceEvaluationMatrix; label: string }[] = [
  { key: 'persona_fidelity', label: 'Voice match' },
  { key: 'uniqueness', label: 'Uniqueness' },
  { key: 'specificity', label: 'Specificity' },
  { key: 'so_what', label: 'Value' },
  { key: 'pain_resonance', label: 'Resonance' },
];

/**
 * Manual drafting studio (Typefully-style): drafts rail on the left, borderless
 * editor in the middle, platform toggles on top. Drafts persist to the posts
 * library (`status='draft'`); publish + queue reuse the existing composer and
 * /api/publish queue, so nothing here re-implements the pipeline.
 */
export function WriteStudio(): JSX.Element {
  const { toast } = useToast();
  const [platform, setPlatform] = useState<Platform>('linkedin');
  const [drafts, setDrafts] = useState<PostRow[]>([]);
  const [queue, setQueue] = useState<PostRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [mentions, setMentions] = useState<PostMention[]>([]);
  // @mention typeahead: query text after the trailing @, its index, and results.
  const [mentionQuery, setMentionQuery] = useState<{ q: string; start: number } | null>(null);
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([]);
  const [suggestIdx, setSuggestIdx] = useState(0);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [publishMenuOpen, setPublishMenuOpen] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [review, setReview] = useState<VoiceEvaluationMatrix | null>(null);
  const [profile, setProfile] = useState<{ name: string; headline: string | null }>({
    name: 'You',
    headline: null,
  });

  // Latest values for the debounced save without re-arming the timer.
  const stateRef = useRef({ activeId, text, platform, imageUrl, mentions });
  stateRef.current = { activeId, text, platform, imageUrl, mentions };
  const saveRef = useRef({ inFlight: false, queued: false });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const reloadLists = useCallback(async () => {
    try {
      const [dRes, qRes] = await Promise.all([
        fetchWithAuth('/api/posts?status=draft&limit=50'),
        fetchWithAuth('/api/posts?status=scheduled&limit=50'),
      ]);
      if (dRes.ok) setDrafts(((await dRes.json()).posts ?? []) as PostRow[]);
      if (qRes.ok) setQueue(((await qRes.json()).posts ?? []) as PostRow[]);
    } catch {
      /* keep whatever we had */
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadLists();
    fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.profile?.displayName) {
          setProfile({ name: data.profile.displayName, headline: data.profile.headline ?? null });
        }
      })
      .catch(() => {});
  }, [reloadLists]);

  /** Create-or-update the active draft from the latest editor state. */
  const persist = useCallback(async (): Promise<string | null> => {
    const { activeId: id, text: body, platform: plat, imageUrl: img, mentions: tags } = stateRef.current;
    if (!body.trim()) return id;
    if (saveRef.current.inFlight) {
      saveRef.current.queued = true;
      return id;
    }
    saveRef.current.inFlight = true;
    setSaving(true);
    let resultId: string | null = id;
    try {
      if (id) {
        const res = await fetchWithAuth(`/api/posts/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: draftTitle(body), script: body, caption: body, platform: plat, image_url: img, mentions: tags }),
        });
        if (!res.ok) toast('Could not save draft', 'error');
      } else {
        const res = await fetchWithAuth('/api/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: draftTitle(body),
            platform: plat,
            status: 'draft',
            script: body,
            caption: body,
            image_url: img,
            mentions: tags,
            // 'general' sentinel: server classifies the real pillar from content.
            pillar: 'general',
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.post?.id) {
          resultId = data.post.id as string;
          setActiveId(resultId);
        } else {
          toast((data as { error?: string }).error ?? 'Could not save draft', 'error');
        }
      }
      void reloadLists();
    } finally {
      saveRef.current.inFlight = false;
      setSaving(false);
      if (saveRef.current.queued) {
        saveRef.current.queued = false;
        void persist();
      }
    }
    return resultId;
  }, [reloadLists, toast]);

  // Debounced autosave on edit.
  useEffect(() => {
    if (!text.trim()) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void persist(), 900);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [text, persist]);

  function newDraft() {
    setActiveId(null);
    setText('');
    setImageUrl(null);
    setMentions([]);
    setMentionQuery(null);
    setShowLinkInput(false);
    setReview(null);
  }

  function selectDraft(d: PostRow) {
    setActiveId(d.id);
    setText(d.script ?? d.caption ?? '');
    setImageUrl(d.image_url ?? null);
    setMentions(d.mentions ?? []);
    setMentionQuery(null);
    setShowLinkInput(false);
    setReview(null);
    if (isPlatform(d.platform)) setPlatform(d.platform);
  }

  /** Track the `@partial` the caret is inside (LinkedIn only - X tags natively). */
  function handleEditorChange(value: string, caret: number) {
    setText(value);
    if (platform !== 'linkedin') { setMentionQuery(null); return; }
    const upToCaret = value.slice(0, caret);
    const match = /(^|[\s(])@([A-Za-z][A-Za-z0-9 .'-]{0,40})$/.exec(upToCaret);
    if (match) {
      setMentionQuery({ q: match[2], start: caret - match[2].length - 1 });
    } else {
      setMentionQuery(null);
    }
  }

  // Debounced people-search behind the typeahead.
  useEffect(() => {
    if (!mentionQuery || mentionQuery.q.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const handle = setTimeout(async () => {
      setSuggestLoading(true);
      try {
        const res = await fetchWithAuth(`/api/write/mentions?q=${encodeURIComponent(mentionQuery.q.trim())}`);
        if (!res.ok) { setSuggestions([]); return; }
        const data = await res.json().catch(() => ({}));
        setSuggestions(((data as { suggestions?: MentionSuggestion[] }).suggestions ?? []).slice(0, 5));
        setSuggestIdx(0);
      } finally {
        setSuggestLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [mentionQuery]);

  /** Replace the typed `@partial` with the chosen person and record the tag. */
  function pickMention(s: MentionSuggestion) {
    if (!mentionQuery) return;
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? text.length;
    const next = `${text.slice(0, mentionQuery.start)}@${s.name} ${text.slice(caret)}`;
    setText(next);
    setMentions((prev) =>
      prev.some((m) => m.profile_id === s.id) || prev.length >= 10
        ? prev
        : [...prev, { name: s.name, profile_id: s.id }],
    );
    setMentionQuery(null);
    setSuggestions([]);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = mentionQuery.start + s.name.length + 2;
      el.setSelectionRange(pos, pos);
    });
  }

  async function handleImageUpload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetchWithAuth('/api/upload', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast((data as { error?: string }).error ?? 'Upload failed', 'error');
        return;
      }
      setImageUrl((data as { url?: string }).url ?? null);
      // Persist the attachment onto the draft right away.
      if (stateRef.current.text.trim()) void persist();
    } catch {
      toast('Image upload failed', 'error');
    } finally {
      setUploading(false);
    }
  }

  /** Insert a snippet at the cursor (or append) and refocus. */
  function insertAtCursor(snippet: string) {
    const el = textareaRef.current;
    if (!el) {
      setText((t) => t + snippet);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    setText(text.slice(0, start) + snippet + text.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function addLink() {
    const withScheme = normalizeUrl(linkValue);
    if (!withScheme) { setShowLinkInput(false); return; }
    insertAtCursor(`\n${withScheme}\n`);
    setLinkValue('');
    setShowLinkInput(false);
  }

  async function deleteDraft(id: string) {
    const res = await fetchWithAuth(`/api/posts/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast('Could not delete draft', 'error');
      return;
    }
    if (id === activeId) newDraft();
    void reloadLists();
  }

  /**
   * Next queue slot: 9:00 tomorrow, skipping days that already have a queued
   * post. ponytail: naive daily cadence; per-user slot settings if requested.
   */
  function nextSlot(): string {
    const taken = new Set(
      queue
        .map((q) => q.scheduled_publish_at && new Date(q.scheduled_publish_at).toDateString())
        .filter(Boolean),
    );
    const slot = new Date();
    slot.setDate(slot.getDate() + 1);
    slot.setHours(9, 0, 0, 0);
    while (taken.has(slot.toDateString())) slot.setDate(slot.getDate() + 1);
    return slot.toISOString();
  }

  async function addToQueue() {
    if (!text.trim() || queueing) return;
    setQueueing(true);
    try {
      const id = await persist();
      if (!id) return;
      const scheduledAt = nextSlot();
      const res = await fetchWithAuth('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: id, platform, content: text, scheduledAt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast((data as { error?: string }).error ?? 'Could not queue post', 'error');
        return;
      }
      // /api/publish stamps scheduled_publish_at; flip status so the draft rail
      // and the queue pill both pick it up.
      await fetchWithAuth(`/api/posts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'scheduled' }),
      });
      toast(`Queued for ${new Date(scheduledAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`, 'success');
      newDraft();
      void reloadLists();
    } finally {
      setQueueing(false);
      setPublishMenuOpen(false);
    }
  }

  async function runReview() {
    if (!text.trim() || reviewing) return;
    setReviewing(true);
    setReview(null);
    try {
      const res = await fetchWithAuth('/api/write/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, platform }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast((data as { error?: string }).error ?? 'Review failed', 'error');
        return;
      }
      setReview((data as { evaluation: VoiceEvaluationMatrix }).evaluation);
    } finally {
      setReviewing(false);
    }
  }

  const platformEnabled = ENABLED_PLATFORMS.has(platform);
  const platformLabel = PLATFORM_LABELS[platform];
  const canAct = Boolean(text.trim()) && platformEnabled;
  const initials = getInitials(profile.name);

  return (
    <div className="flex min-h-[calc(100vh-8rem)] w-full flex-col">
      {/* Top bar: drafts header / platform toggles / review + queue */}
      <div className="mb-8 flex items-center gap-4">
        <div className="flex w-[280px] shrink-0 items-center gap-2">
          <span className="text-lg font-semibold tracking-[-0.02em] text-ink">Drafts</span>
          <span className="text-sm text-ink3">{drafts.length}</span>
          <button
            type="button"
            onClick={newDraft}
            className="ml-auto inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-ink transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/30"
          >
            <Plus className="h-4 w-4" /> New
          </button>
        </div>

        <div className="flex flex-1 items-center justify-center gap-2">
          {PLATFORM_TOGGLES.map(({ id, icon: Icon }) => {
            const enabled = ENABLED_PLATFORMS.has(id);
            const active = platform === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => enabled && setPlatform(id)}
                disabled={!enabled}
                aria-label={enabled ? `Write for ${PLATFORM_LABELS[id]}` : `${PLATFORM_LABELS[id]} coming soon`}
                title={enabled ? PLATFORM_LABELS[id] : `${PLATFORM_LABELS[id]} - coming soon`}
                aria-pressed={active}
                className={`flex h-10 w-10 items-center justify-center rounded-full transition-all duration-200 ${
                  active
                    ? 'bg-white shadow-sm ring-1 ring-hair2'
                    : enabled
                      ? 'cursor-pointer opacity-55 hover:bg-white/70 hover:opacity-100'
                      : 'cursor-not-allowed opacity-25'
                }`}
              >
                <Icon className="h-[18px] w-[18px]" />
              </button>
            );
          })}
        </div>

        <div className="flex w-[280px] shrink-0 items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void runReview()}
            disabled={!text.trim() || reviewing}
            className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-full border border-hair bg-white/70 px-3.5 text-sm font-medium text-ink transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/30"
          >
            {reviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-accent-primary" />}
            Review
          </button>
          <div
            className="relative"
            onMouseEnter={() => setQueueOpen(true)}
            onMouseLeave={() => setQueueOpen(false)}
          >
            <button
              type="button"
              onClick={() => setQueueOpen((o) => !o)}
              aria-expanded={queueOpen}
              className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-full border border-hair bg-white/70 px-3.5 text-sm font-medium text-ink transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/30"
            >
              Queue <span className="text-ink3">{queue.length}</span>
              <ChevronDown className={`h-4 w-4 text-ink3 transition-transform ${queueOpen ? 'rotate-180' : ''}`} />
            </button>
            {queueOpen && (
              /* pt-2 (not mt-2) keeps the hover path contiguous from pill to menu */
              <div className="absolute right-0 top-full z-40 pt-2">
              <div className="w-72 rounded-xl border border-hair bg-white p-2 shadow-lg">
                {queue.length === 0 && (
                  <p className="px-3 py-2 text-sm text-ink2">Nothing queued yet.</p>
                )}
                {queue.map((q) => (
                  <div key={q.id} className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-paper2">
                    <Clock className="h-3.5 w-3.5 shrink-0 text-ink3" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{q.title}</span>
                      <span className="block text-[12px] text-ink3">
                        {q.scheduled_publish_at
                          ? new Date(q.scheduled_publish_at).toLocaleString(undefined, {
                              weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                            })
                          : 'Scheduled'}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-1 gap-8">
        {/* Drafts rail */}
        <div className="hidden w-[280px] shrink-0 space-y-2 md:block">
          {listLoading && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-ink2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {!listLoading && drafts.length === 0 && (
            <p className="px-3 py-2 text-sm text-ink3">No drafts yet. Start typing - it saves itself.</p>
          )}
          {drafts.map((d) => {
            const Icon = PLATFORM_TOGGLES.find((p) => p.id === d.platform)?.icon ?? LinkedInLogo;
            return (
              <div
                key={d.id}
                className={`group flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-colors ${
                  d.id === activeId
                    ? 'border-hair2 bg-white shadow-sm'
                    : 'border-hair bg-white/60 hover:border-hair2 hover:bg-white/85'
                }`}
                onClick={() => selectDraft(d)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') selectDraft(d); }}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{d.title}</span>
                  <span className="block text-[12px] text-ink3">{formatRelative(d.updated_at)}</span>
                </span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void deleteDraft(d.id); }}
                  aria-label={`Delete "${d.title}"`}
                  className="hidden cursor-pointer rounded p-1 text-ink3 transition-colors hover:text-flame group-hover:block"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        {/* Editor: compose card styled after the real platform's post box.
            Drop an image anywhere on the card to attach it. */}
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
          <div
            className={`rounded-2xl border border-hair bg-white shadow-sm ${
              dragActive ? 'ring-2 ring-accent-primary ring-inset' : ''
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              const f = Array.from(e.dataTransfer.files).find((file) => file.type.startsWith('image/'));
              if (f) void handleImageUpload(f);
            }}
          >
            <div className="px-5 pt-4">
              {platform === 'twitter' ? (
                /* X: avatar left, flush editor right */
                <div className="flex gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">
                    {initials}
                  </span>
                  <textarea
                    ref={textareaRef}
                    value={text}
                    onChange={(e) => handleEditorChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
                    placeholder="What's happening?"
                    aria-label="X draft"
                    className="min-h-[180px] w-full resize-none bg-transparent pt-2 text-[17px] leading-relaxed text-ink outline-none placeholder:text-ink3"
                  />
                </div>
              ) : (
                /* LinkedIn: header with name + audience pill, editor below */
                <>
                  <div className="flex items-center gap-3">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">
                      {initials}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-semibold text-ink">{profile.name}</span>
                      <span className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-hair px-2 py-0.5 text-[11px] text-ink2">
                        <Globe2 className="h-3 w-3" /> Anyone
                      </span>
                    </span>
                  </div>
                  <div className="relative">
                    <textarea
                      ref={textareaRef}
                      value={text}
                      onChange={(e) => handleEditorChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
                      onKeyDown={(e) => {
                        if (!mentionQuery || suggestions.length === 0) return;
                        if (e.key === 'ArrowDown') { e.preventDefault(); setSuggestIdx((i) => (i + 1) % suggestions.length); }
                        else if (e.key === 'ArrowUp') { e.preventDefault(); setSuggestIdx((i) => (i - 1 + suggestions.length) % suggestions.length); }
                        else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(suggestions[suggestIdx]); }
                        else if (e.key === 'Escape') { setMentionQuery(null); setSuggestions([]); }
                      }}
                      placeholder="What do you want to talk about?"
                      aria-label={`${platformLabel} draft`}
                      className="mt-3 min-h-[240px] w-full resize-none bg-transparent text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink3"
                    />
                    {mentionQuery && (suggestions.length > 0 || suggestLoading) && (
                      <div
                        role="listbox"
                        aria-label="Mention suggestions"
                        className="absolute left-0 top-full z-40 mt-1 w-80 max-w-full rounded-xl border border-hair bg-white p-1.5 shadow-lg"
                      >
                        {suggestLoading && suggestions.length === 0 && (
                          <div className="flex items-center gap-2 px-3 py-2 text-sm text-ink2">
                            <Loader2 className="h-4 w-4 animate-spin" /> Searching LinkedIn…
                          </div>
                        )}
                        {suggestions.map((s, i) => (
                          <button
                            key={s.id}
                            type="button"
                            role="option"
                            aria-selected={i === suggestIdx}
                            onMouseDown={(e) => { e.preventDefault(); pickMention(s); }}
                            onMouseEnter={() => setSuggestIdx(i)}
                            className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
                              i === suggestIdx ? 'bg-paper2' : ''
                            }`}
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white">
                              {getInitials(s.name)}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-ink">{s.name}</span>
                              {s.headline && (
                                <span className="block truncate text-[12px] text-ink2">{s.headline}</span>
                              )}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {mentions.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {mentions.map((m) => (
                    <span
                      key={m.profile_id}
                      className="inline-flex items-center gap-1 rounded-full border border-hair bg-paper2 px-2.5 py-1 text-[12px] font-medium text-ink"
                    >
                      <AtSign className="h-3 w-3 text-accent-primary" />
                      {m.name}
                      <button
                        type="button"
                        onClick={() => setMentions((prev) => prev.filter((x) => x.profile_id !== m.profile_id))}
                        aria-label={`Remove mention ${m.name}`}
                        className="cursor-pointer text-ink3 transition-colors hover:text-ink"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {imageUrl && (
                <div className="relative mb-3 overflow-hidden rounded-lg border border-hair">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl} alt="Attachment" className="max-h-72 w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => { setImageUrl(null); if (activeId) void persist(); }}
                    className="absolute right-2 top-2 cursor-pointer rounded-full bg-black/60 p-1 text-white"
                    aria-label="Remove image"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              {showLinkInput && (
                <div className="mb-3 flex gap-2">
                  <input
                    autoFocus
                    value={linkValue}
                    onChange={(e) => setLinkValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addLink()}
                    placeholder="Paste a URL"
                    aria-label="Link URL"
                    className="flex-1 rounded-md border border-hair bg-paper2 px-3 py-2 text-sm text-ink outline-none focus:border-hair2"
                  />
                  <button
                    type="button"
                    onClick={addLink}
                    className="cursor-pointer rounded-md border border-hair px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-paper2"
                  >
                    Add
                  </button>
                </div>
              )}
            </div>

            {/* Card toolbar: attach / link / mention, like the real composers */}
            <div className="flex items-center gap-1 border-t border-hair px-4 py-2">
              <label className="flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] text-ink2 transition-colors hover:bg-paper2">
                <ImageIcon className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Photo'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImageUpload(f); e.target.value = ''; }}
                />
              </label>
              <button
                type="button"
                onClick={() => setShowLinkInput((s) => !s)}
                className="flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] text-ink2 transition-colors hover:bg-paper2"
              >
                <Link2 className="h-4 w-4" /> Link
              </button>
              <button
                type="button"
                onClick={() => insertAtCursor('@')}
                className="flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] text-ink2 transition-colors hover:bg-paper2"
              >
                <AtSign className="h-4 w-4" /> Mention
              </button>
              <span className="ml-auto flex items-center gap-3">
                <CharCount text={text} platform={platform} />
                <span className="text-[12px] text-ink3">{saving ? 'Saving…' : activeId ? 'Saved' : ''}</span>
              </span>
            </div>
          </div>

          <div className="sticky bottom-4 mt-6 flex items-center justify-end gap-2">
            <div
              className="relative flex overflow-visible rounded-full border border-hair bg-white shadow-sm"
              onMouseEnter={() => { if (canAct) setPublishMenuOpen(true); }}
              onMouseLeave={() => setPublishMenuOpen(false)}
            >
              <button
                type="button"
                onClick={() => {
                  if (!canAct) return;
                  // Save first so the composer publishes the row (mentions +
                  // image ride along) instead of inserting a duplicate.
                  void persist().then(() => setPublishOpen(true));
                }}
                disabled={!canAct}
                title={platformEnabled ? undefined : `${platformLabel} publishing coming soon`}
                className="inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-l-full py-2 pl-4 pr-3 text-sm font-medium text-ink transition-colors hover:bg-paper2 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/30"
              >
                <Send className="h-4 w-4" />
                Publish to {platformLabel}
              </button>
              <button
                type="button"
                onClick={() => setPublishMenuOpen((o) => !o)}
                disabled={!canAct}
                aria-label="More publish options"
                aria-expanded={publishMenuOpen}
                className="inline-flex min-h-[40px] cursor-pointer items-center rounded-r-full border-l border-hair px-2.5 text-ink transition-colors hover:bg-paper2 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/30"
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${publishMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {publishMenuOpen && (
                /* pb-2 (not mb-2) keeps the hover path contiguous upward */
                <div className="absolute bottom-full right-0 z-40 pb-2">
                <div className="w-56 rounded-xl border border-hair bg-white p-1.5 shadow-lg">
                  <button
                    type="button"
                    onClick={() => void addToQueue()}
                    disabled={queueing}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-paper2 disabled:opacity-40"
                  >
                    {queueing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
                    Add to {platformLabel} queue
                  </button>
                </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right column: mirrors the drafts rail width so the editor stays
            centered on the page; holds the review panel when one is open. */}
        <aside className="hidden w-[280px] shrink-0 md:block">
          {review && (
            <div className="sticky top-6 rounded-xl border border-hair bg-white/80 p-4 backdrop-blur-sm">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-ink">AI review</span>
                <button
                  type="button"
                  onClick={() => setReview(null)}
                  aria-label="Close review"
                  className="cursor-pointer rounded p-1 text-ink3 transition-colors hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-2.5">
                {REVIEW_ROWS.map(({ key, label }) => {
                  const value = Number(review[key] ?? 0);
                  return (
                    <div key={key}>
                      <div className="mb-1 flex items-center justify-between text-[12px]">
                        <span className="text-ink2">{label}</span>
                        <span className="font-medium text-ink">{value}/10</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-paper2">
                        <div
                          className={`h-full rounded-full ${value >= 8 ? 'bg-accent-secondary' : value >= 6 ? 'bg-accent-primary' : 'bg-flame'}`}
                          style={{ width: `${value * 10}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              {review.revision_notes && (
                <p className="mt-3 border-t border-hair pt-3 text-[13px] leading-relaxed text-ink2">
                  {review.revision_notes}
                </p>
              )}
            </div>
          )}
        </aside>
      </div>

      <LinkedInComposer
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        initialText={text}
        platform={platform}
        postId={activeId ?? undefined}
        initialImageUrl={imageUrl}
        onPublished={() => {
          newDraft();
          void reloadLists();
        }}
      />
    </div>
  );
}
