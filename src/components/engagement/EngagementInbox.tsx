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
} from 'lucide-react';
import type { EngagementInboxResult, InboxComment, InboxPostGroup } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { SkeletonLines } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

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
        {group.comments.map((item) => (
          <CommentRow
            key={item.comment.id}
            item={item}
            draftEdits={draftEdits}
            sendingId={sendingId}
            onDraftChange={onDraftChange}
            onApproveSend={onApproveSend}
            selected={selected.has(item.comment.id)}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </ul>
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
}: {
  item: InboxComment;
  draftEdits: Record<string, string>;
  sendingId: string | null;
  onDraftChange: (queueId: string, text: string) => void;
  onApproveSend: (item: InboxComment) => void;
  selected: boolean;
  onToggleSelect: (commentId: string) => void;
}) {
  const { comment, queue } = item;
  const isSent = queue?.status === 'sent' || Boolean(item.answered_natively);
  // Drafts are keyed by queue id when the AI wrote one, and by comment id when
  // the reply is hand-written and has no queue row yet.
  const draftKey = queue?.id ?? comment.id;
  const draftValue = draftEdits[draftKey] ?? queue?.draft_reply ?? '';

  return (
    <li className="flex gap-3 p-4">
      {!isSent && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(comment.id)}
          aria-label={`Select reply to ${authorLabel(item)}`}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-accent-primary"
        />
      )}
      <div className="min-w-0 flex-1 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-medium text-ink">{authorLabel(item)}</p>
          {comment.author_headline && (
            <p className="text-[11px] text-ink3 mt-0.5 line-clamp-1">{comment.author_headline}</p>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-badge text-xs font-medium ${statusTone(queue, item.answered_natively)}`}
        >
          {isSent ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : queue?.status === 'failed' ? (
            <AlertCircle className="h-3.5 w-3.5" />
          ) : (
            <Clock className="h-3.5 w-3.5" />
          )}
          {statusLabel(queue, item.answered_natively)}
        </span>
      </div>

      <blockquote className="text-[15px] text-text-primary leading-relaxed border-l-2 border-coral pl-3">
        {comment.comment_text}
      </blockquote>

      {!isSent && (
        <div className="space-y-2">
          <label className="block">
            <span className="section-label">Your reply</span>
            {/* No longer gated on an AI draft existing: you can type a reply and
                send it, and the server creates the queue row on the way through. */}
            <AutoGrowReply
              value={draftValue}
              placeholder="Write a reply, or tap “Draft” for one in your voice…"
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
        <p className="text-sm text-text-secondary bg-bg-tertiary rounded-md px-3 py-2">
          <span className="font-medium text-text-primary">You replied: </span>
          {queue.draft_reply}
        </p>
      )}
      </div>
    </li>
  );
}
