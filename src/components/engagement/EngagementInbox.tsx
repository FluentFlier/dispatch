'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  MessageCircle,
  RefreshCw,
  Sparkles,
  Send,
  CheckCircle2,
  Clock,
  AlertCircle,
  ThumbsUp,
  MessageSquare,
  CornerDownLeft,
} from 'lucide-react';
import type { EngagementInboxResult, InboxComment, InboxPostGroup } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { SkeletonLines } from '@/components/ui/Skeleton';
import { getInitials } from '@/lib/compose-preview';
import { normalizeDashboardPlatform } from '@/lib/constants';
import { formatRelative } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';

/** LinkedIn/X-style age: 31m, 5h, 2d, 3mo, 1y. */
function shortAge(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.round(days / 7);
  if (days < 30) return `${weeks}w`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.round(days / 365)}y`;
}

/** Comments rendered before the "Load more" button appears, then per click. */
const INITIAL_COMMENTS = 3;
const LOAD_MORE_STEP = 10;

function authorLabel(comment: InboxComment): string {
  const c = comment.comment;
  if (c.author_name) return c.author_name;
  if (c.author_handle) return `@${c.author_handle.replace(/^@/, '')}`;
  return 'Someone';
}

function statusLabel(queue: InboxComment['queue'], answeredNatively = false): string {
  // Mirrors classifyComment on the server: a reply written on the platform is
  // still a reply, even though this app never queued it.
  if (answeredNatively) return 'You replied';
  if (!queue) return 'Needs a reply';
  if (queue.status === 'sent') return 'Reply sent';
  if (queue.status === 'draft' || queue.status === 'approved') return 'Draft ready';
  if (queue.status === 'failed') return 'Send failed. Try again';
  return 'Needs a reply';
}

function statusTone(queue: InboxComment['queue'], answeredNatively = false): string {
  if (answeredNatively) return 'text-ink bg-lime/15';
  if (!queue) return 'text-ink2 bg-paper2/80';
  if (queue.status === 'sent') return 'text-ink bg-lime/15';
  if (queue.status === 'draft' || queue.status === 'approved') return 'text-blue bg-blue/10';
  if (queue.status === 'failed') return 'text-flame bg-flame/10';
  return 'text-ink2 bg-paper2/80';
}

interface EngagementInboxProps {
  postId?: string;
  compact?: boolean;
  /**
   * Render the Sync / Draft / Send row into this element instead of inline.
   * The editor puts it in the modal footer next to the status pipeline, where
   * it stays put while the list below it reloads.
   */
  actionsPortal?: HTMLElement | null;
}

export default function EngagementInbox({ postId, compact = false, actionsPortal }: EngagementInboxProps) {
  const { toast } = useToast();
  const [data, setData] = useState<EngagementInboxResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [sendingBulk, setSendingBulk] = useState(false);
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);
  // Comment ids ticked for a batch send from the footer button.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelect = useCallback((commentId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(commentId)) next.delete(commentId);
      else next.add(commentId);
      return next;
    });
  }, []);

  const inboxUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (postId) params.set('postId', postId);
    const q = params.toString();
    return `/api/engagement/inbox${q ? `?${q}` : ''}`;
  }, [postId]);

  const loadInbox = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(inboxUrl);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load comments');
      }
      const json = (await res.json()) as EngagementInboxResult;
      setData(json);
      setDraftEdits((prev) => {
        const next: Record<string, string> = { ...prev };
        for (const group of json.groups) {
          for (const item of group.comments) {
            if (item.queue?.id && !(item.queue.id in next)) {
              next[item.queue.id] = item.queue.draft_reply;
            }
          }
        }
        return next;
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load', 'error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [inboxUrl, toast]);

  useEffect(() => {
    loadInbox();
  }, [loadInbox]);

  // Connection status drives the empty-state copy: a connected user must never
  // be told to "Connect accounts" (they'd think their LinkedIn dropped).
  useEffect(() => {
    let cancelled = false;
    fetch('/api/social-accounts')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled) setConnected(((j?.accounts as unknown[]) ?? []).length > 0);
      })
      .catch(() => {
        if (!cancelled) setConnected(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const body = postId ? { postIds: [postId] } : {};
      const res = await fetch('/api/engagement/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Sync failed');
      toast(
        result.inserted
          ? `Synced ${result.inserted} new comment${result.inserted === 1 ? '' : 's'}`
          : 'Comments are up to date',
      );
      await loadInbox();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Sync failed', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleDraftReplies = async () => {
    setDrafting(true);
    try {
      const res = await fetch('/api/engagement/draft-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: postId ? 30 : 20 }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Draft failed');
      if (result.drafted > 0) {
        toast(`Drafted ${result.drafted} repl${result.drafted === 1 ? 'y' : 'ies'} in your voice`);
      } else {
        toast('No new comments to draft');
      }
      await loadInbox();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Draft failed', 'error');
    } finally {
      setDrafting(false);
    }
  };

  const handleSendApproved = async () => {
    // With rows ticked, send exactly those - with whatever is in each box,
    // typed or drafted. With nothing ticked, fall back to every approved draft.
    const picked = (data?.groups ?? [])
      .flatMap((g) => g.comments)
      .filter((item) => selected.has(item.comment.id));

    const manualDrafts: Record<string, string> = {};
    for (const item of picked) {
      const text = draftEdits[item.queue?.id ?? item.comment.id] ?? item.queue?.draft_reply ?? '';
      if (text.trim()) manualDrafts[item.comment.id] = text;
    }

    if (picked.length > 0 && Object.keys(manualDrafts).length === 0) {
      toast('Write a reply for the selected comments first', 'error');
      return;
    }

    setSendingBulk(true);
    try {
      const res = await fetch('/api/engagement/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          Object.keys(manualDrafts).length > 0
            ? { approveFirst: true, manualDrafts }
            : { approveFirst: true },
        ),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Send failed');
      if (result.stubbed > 0) {
        toast(
          `Connect LinkedIn or X in Settings to send replies. ${result.stubbed} draft${result.stubbed === 1 ? '' : 's'} kept ready.`,
          'error',
        );
      } else if (result.sent > 0) {
        toast(`Sent ${result.sent} repl${result.sent === 1 ? 'y' : 'ies'}`);
      } else {
        toast('No approved drafts to send');
      }
      setSelected(new Set());
      await loadInbox();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Send failed', 'error');
    } finally {
      setSendingBulk(false);
    }
  };

  const handleApproveSend = async (item: InboxComment) => {
    // Keyed by comment, not queue: a hand-written reply has no queue row yet
    // and the server creates one. Sending no longer requires an AI draft first.
    const draftKey = item.queue?.id ?? item.comment.id;
    const draftText = draftEdits[draftKey] ?? item.queue?.draft_reply ?? '';
    if (!draftText.trim()) {
      toast('Write a reply before sending', 'error');
      return;
    }

    setSendingId(draftKey);
    try {
      const res = await fetch('/api/engagement/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approveFirst: true,
          manualDrafts: { [item.comment.id]: draftText },
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Send failed');
      if (result.stubbed > 0) {
        toast('Connect LinkedIn or X in Settings to send replies.', 'error');
      } else {
        toast('Reply sent');
      }
      await loadInbox();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Send failed', 'error');
    } finally {
      setSendingId(null);
    }
  };

  const updateDraft = (queueId: string, text: string) => {
    setDraftEdits((prev) => ({ ...prev, [queueId]: text }));
  };

  // Auto-sync once per session when the inbox is empty but an account IS
  // connected: imported/published posts have publish_jobs rows, so the very
  // first visit should pull their comments instead of showing an empty inbox.
  // Session-scoped guard keeps Unipile calls bounded (cost) - repeat visits with
  // genuinely zero comments won't re-hammer the provider.
  const isEmptyNow = (data?.groups.length ?? 0) === 0;
  useEffect(() => {
    if (loading || syncing || connected !== true || !isEmptyNow) return;
    const guardKey = `engagement-autosync:${postId ?? 'all'}`;
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(guardKey)) return;
    try {
      sessionStorage.setItem(guardKey, '1');
    } catch {
      /* private mode - proceed without the guard */
    }
    handleSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, connected, isEmptyNow]);

  // Any fetch OR sync counts as busy. Gating the skeleton on `loading` alone
  // left the previous list on screen while Unipile was still being read, so new
  // comments appeared out of nowhere with nothing to say they were coming.
  const busy = loading || syncing;

  const groups = data?.groups ?? [];
  const summary = data?.summary;
  const isEmpty = groups.length === 0;

  // In the portal (the editor footer) the row shares one line with the status
  // pipeline, so the labels shorten to keep it from wrapping underneath. Inline
  // - the full-page inbox - there is room for the long labels.
  const actionLabels = actionsPortal
    ? { sync: 'Sync', draft: 'Draft', send: 'Send' }
    : { sync: 'Sync comments', draft: 'Draft replies', send: 'Send approved' };

  const actions = (
    <div className="flex shrink-0 items-center justify-end gap-2">
      <Button
        variant="secondary"
        size="md"
        loading={syncing}
        onClick={handleSync}
        title="Sync comments"
        className="min-h-[44px]"
      >
        <RefreshCw className="h-4 w-4" />
        {actionLabels.sync}
      </Button>
      <Button
        variant="secondary"
        size="md"
        loading={drafting}
        onClick={handleDraftReplies}
        title="Draft replies in your voice"
        className="min-h-[44px]"
      >
        <Sparkles className="h-4 w-4" />
        {actionLabels.draft}
      </Button>
      <Button
        variant="primary"
        size="md"
        loading={sendingBulk}
        onClick={handleSendApproved}
        title="Send approved replies"
        className="min-h-[44px]"
      >
        <Send className="h-4 w-4" />
        {selected.size > 0 ? `Send ${selected.size}` : actionLabels.send}
      </Button>
    </div>
  );

  return (
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
      {summary && !isEmpty && !compact && (
        <p className="text-[12px] tracking-[0.02em] text-ink3">
          {summary.comments} comment{summary.comments === 1 ? '' : 's'} across {summary.posts}{' '}
          post{summary.posts === 1 ? '' : 's'} · {summary.needs_reply} need
          {summary.needs_reply === 1 ? 's' : ''} a reply · {summary.drafted} drafted · {summary.sent}{' '}
          sent
        </p>
      )}

      {actionsPortal ? createPortal(actions, actionsPortal) : actions}

      {busy ? (
        <div className="rounded-lg border border-border bg-bg-secondary p-6 shadow-card">
          <p className="mb-3 text-[12px] text-text-secondary">
            {syncing ? 'Pulling comments from LinkedIn…' : 'Loading comments…'}
          </p>
          <SkeletonLines count={4} />
        </div>
      ) : isEmpty ? (
        <div className="rounded-lg border border-border bg-bg-secondary p-8 md:p-10 text-center shadow-card">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-md bg-coral-light text-accent-primary mb-5">
            <MessageCircle className="h-7 w-7" strokeWidth={1.75} />
          </div>
          <h2 className="font-normal tracking-[-0.025em] text-ink text-[22px]">No comments yet</h2>
          <p className="mt-2 text-sm text-text-secondary max-w-sm mx-auto leading-relaxed">
            {connected === false
              ? 'Connect your LinkedIn or X account in settings, then sync to pull comments on your posts.'
              : postId
                ? 'No comments on this post yet. Sync to check for new ones.'
                : 'Sync to pull comments on your posts from your connected account. They will show up here grouped by post.'}
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              variant={connected === false ? 'secondary' : 'primary'}
              size="md"
              loading={syncing}
              onClick={handleSync}
            >
              <RefreshCw className="h-4 w-4" />
              {syncing ? 'Syncing…' : 'Sync now'}
            </Button>
            {connected === false && !postId && (
              <Link
                href="/settings"
                className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-md text-[15px] font-medium border border-border bg-bg-secondary text-text-primary hover:bg-bg-tertiary transition-colors"
              >
                Connect accounts
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <PostCommentGroup
              key={group.post_id}
              group={group}
              compact={compact}
              draftEdits={draftEdits}
              sendingId={sendingId}
              onDraftChange={updateDraft}
              onApproveSend={handleApproveSend}
              selected={selected}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PostCommentGroup({
  group,
  compact,
  draftEdits,
  sendingId,
  onDraftChange,
  onApproveSend,
  selected,
  onToggleSelect,
}: {
  group: InboxPostGroup;
  compact: boolean;
  draftEdits: Record<string, string>;
  sendingId: string | null;
  onDraftChange: (queueId: string, text: string) => void;
  onApproveSend: (item: InboxComment) => void;
  selected: Set<string>;
  onToggleSelect: (commentId: string) => void;
}) {
  // Feeds show a couple of comments and let you ask for the rest; dumping
  // every one of them turns a busy post into an unreadable wall.
  const [shown, setShown] = useState(INITIAL_COMMENTS);
  const visible = group.comments.slice(0, shown);
  const remaining = group.comments.length - visible.length;

  const needs = group.stats.needs_reply;
  const drafted = group.stats.drafted;

  return (
    <section className="rounded-lg border border-border bg-bg-secondary shadow-card overflow-hidden">
      {/* The post title is dropped in the editor: you got here by opening that
          exact post, and its title is already the modal heading. */}
      <div className="px-4 py-3 border-b border-hair bg-bg-tertiary/60">
        {!compact && (
          <h2 className="font-normal tracking-[-0.025em] text-ink text-[18px] leading-tight">{group.post_title}</h2>
        )}
        <p className={`text-[11px] tracking-[0.08em] text-ink3 ${compact ? '' : 'mt-1.5'}`}>
          {group.post_platform} · {group.stats.total} comment
          {group.stats.total === 1 ? '' : 's'}
          {needs > 0 && ` · ${needs} waiting for you`}
          {drafted > 0 && ` · ${drafted} draft${drafted === 1 ? '' : 's'} ready`}
        </p>
      </div>

      <ul className={`divide-y divide-hair ${compact ? '' : ''}`}>
        {visible.map((item) => (
          <CommentRow
            key={item.comment.id}
            item={item}
            draftEdits={draftEdits}
            sendingId={sendingId}
            onDraftChange={onDraftChange}
            onApproveSend={onApproveSend}
            selected={selected.has(item.comment.id)}
            onToggleSelect={onToggleSelect}
            platform={group.post_platform}
          />
        ))}
      </ul>

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setShown((n) => n + LOAD_MORE_STEP)}
          className="flex w-full min-h-[44px] cursor-pointer items-center gap-2 px-4 py-3 text-[14px] font-semibold text-ink3 transition-colors hover:bg-bg-tertiary/60 hover:text-ink"
        >
          <CornerDownLeft className="h-4 w-4 rotate-90" aria-hidden />
          Load more comments
        </button>
      )}
    </section>
  );
}

/**
 * Grows with what you type, from one line up to a cap, then scrolls. A fixed
 * three-row box wasted space on a one-line reply and hid the end of a long one.
 */
function AutoGrowReply({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (text: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="mt-1.5 block max-h-40 w-full resize-none overflow-y-auto rounded-md border border-border bg-bg-primary px-3 py-2 text-[13px] leading-[1.5] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-hover"
    />
  );
}

function CommentRow({
  item,
  draftEdits,
  sendingId,
  onDraftChange,
  onApproveSend,
  selected,
  onToggleSelect,
  platform,
}: {
  item: InboxComment;
  draftEdits: Record<string, string>;
  sendingId: string | null;
  onDraftChange: (queueId: string, text: string) => void;
  onApproveSend: (item: InboxComment) => void;
  selected: boolean;
  onToggleSelect: (commentId: string) => void;
  platform: string;
}) {
  const { comment, queue } = item;
  const isSent = queue?.status === 'sent' || Boolean(item.answered_natively);
  // Drafts are keyed by queue id when the AI wrote one, and by comment id when
  // the reply is hand-written and has no queue row yet.
  const draftKey = queue?.id ?? comment.id;
  const draftValue = draftEdits[draftKey] ?? queue?.draft_reply ?? '';

  // The reply box opens on Reply, the way it does in the feed. Leaving one open
  // under every comment turned three comments into a full screen and buried the
  // rest of the thread. A drafted or half-typed reply keeps it open.
  const [replying, setReplying] = useState(false);
  const replyOpen = replying || draftValue.trim().length > 0;

  const isX = normalizeDashboardPlatform(platform) === 'twitter';
  const name = authorLabel(item);
  const handle = comment.author_handle?.replace(/^@/, '');
  const when = comment.commented_at ? shortAge(comment.commented_at) : null;

  return (
    <li className="flex gap-3 p-4">
      {!isSent && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(comment.id)}
          aria-label={`Select reply to ${name}`}
          className="mt-4 h-4 w-4 shrink-0 cursor-pointer accent-accent-primary"
        />
      )}
      {/* Drawn the way its own platform draws it, so this reads as the feed the
          creator already knows. LinkedIn: name and headline stacked, the age
          right-aligned on the name line, flat text (no bubble - LinkedIn
          dropped that), then Like | Reply. X: name, @handle and age on one
          line with the text under it. */}
      <div className="flex min-w-0 flex-1 gap-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-[12px] font-semibold text-text-secondary">
          {getInitials(name)}
        </div>

        <div className="min-w-0 flex-1">
          {isX ? (
            <p className="flex flex-wrap items-center gap-x-1.5 text-[14px] leading-tight">
              <span className="font-bold text-ink">{name}</span>
              {handle && <span className="text-ink3">@{handle}</span>}
              {when && <span className="text-ink3">· {when}</span>}
            </p>
          ) : (
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold leading-tight text-ink">{name}</p>
                {comment.author_headline && (
                  <p className="mt-0.5 line-clamp-1 text-[12px] text-ink3">{comment.author_headline}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {when && <span className="text-[12px] text-ink3">{when}</span>}
                <span
                  className={`inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-[11px] font-medium ${statusTone(queue, item.answered_natively)}`}
                >
                  {isSent ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : queue?.status === 'failed' ? (
                    <AlertCircle className="h-3 w-3" />
                  ) : (
                    <Clock className="h-3 w-3" />
                  )}
                  {statusLabel(queue, item.answered_natively)}
                </span>
              </div>
            </div>
          )}

          <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-[1.43] text-text-primary">
            {comment.comment_text}
          </p>

          {/* Icon-only, the way both feeds render it now - the word buttons
              were the older LinkedIn. */}
          <div className="mt-1.5 flex items-center gap-4 text-ink3">
            <ThumbsUp className="h-[18px] w-[18px]" aria-label="Like" />
            {!isSent && (
              <button
                type="button"
                onClick={() => setReplying((open) => !open)}
                aria-label="Reply"
                aria-expanded={replyOpen}
                className="cursor-pointer transition-colors hover:text-ink"
              >
                <MessageSquare className="h-[18px] w-[18px]" />
              </button>
            )}
            {isX && (
              <span
                className={`inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-[11px] font-medium ${statusTone(queue, item.answered_natively)}`}
              >
                {statusLabel(queue, item.answered_natively)}
              </span>
            )}
          </div>

      {!isSent && replyOpen && (
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="section-label">{isX ? 'Post your reply' : 'Add a comment'}</span>
            {/* No longer gated on an AI draft existing: you can type a reply and
                send it, and the server creates the queue row on the way through. */}
            <AutoGrowReply
              value={draftValue}
              placeholder={isX ? 'Post your reply…' : 'Add a comment…'}
              onChange={(text) => onDraftChange(draftKey, text)}
            />
          </label>
          {queue?.last_error && (
            <p className="text-xs text-accent-dark">{queue.last_error}</p>
          )}
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="sm"
              className="min-h-[36px]"
              disabled={!draftValue.trim()}
              loading={sendingId === draftKey}
              onClick={() => onApproveSend(item)}
            >
              <Send className="h-4 w-4" />
              Send
            </Button>
          </div>
        </div>
      )}

      {isSent && queue?.draft_reply && (
        <p className="mt-2 rounded-md bg-bg-tertiary px-3 py-2 text-[13px] text-text-secondary">
          <span className="font-medium text-text-primary">You replied: </span>
          {queue.draft_reply}
        </p>
      )}
        </div>
      </div>
    </li>
  );
}
