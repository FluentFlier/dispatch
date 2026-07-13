'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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

function statusLabel(queue: InboxComment['queue']): string {
  if (!queue) return 'Needs a reply';
  if (queue.status === 'sent') return 'Reply sent';
  if (queue.status === 'draft' || queue.status === 'approved') return 'Draft ready';
  if (queue.status === 'failed') return 'Send failed. Try again';
  return 'Needs a reply';
}

function statusTone(queue: InboxComment['queue']): string {
  if (!queue) return 'text-ink2 bg-paper2/80';
  if (queue.status === 'sent') return 'text-teal bg-teal/10';
  if (queue.status === 'draft' || queue.status === 'approved') return 'text-blue bg-blue/10';
  if (queue.status === 'failed') return 'text-flame bg-flame/10';
  return 'text-ink2 bg-paper2/80';
}

interface EngagementInboxProps {
  postId?: string;
  compact?: boolean;
}

export default function EngagementInbox({ postId, compact = false }: EngagementInboxProps) {
  const { toast } = useToast();
  const [data, setData] = useState<EngagementInboxResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [sendingBulk, setSendingBulk] = useState(false);
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);

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
    setSendingBulk(true);
    try {
      const res = await fetch('/api/engagement/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approveFirst: true }),
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
      await loadInbox();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Send failed', 'error');
    } finally {
      setSendingBulk(false);
    }
  };

  const handleApproveSend = async (item: InboxComment) => {
    if (!item.queue?.id) {
      toast('Draft a reply first', 'error');
      return;
    }
    const queueId = item.queue.id;
    const draftText = draftEdits[queueId] ?? item.queue.draft_reply;
    if (!draftText.trim()) {
      toast('Write a reply before sending', 'error');
      return;
    }

    setSendingId(queueId);
    try {
      const res = await fetch('/api/engagement/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queueIds: [queueId],
          approveFirst: true,
          draftOverrides: { [queueId]: draftText },
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
  // Session-scoped guard keeps Unipile calls bounded (cost) — repeat visits with
  // genuinely zero comments won't re-hammer the provider.
  const isEmptyNow = (data?.groups.length ?? 0) === 0;
  useEffect(() => {
    if (loading || syncing || connected !== true || !isEmptyNow) return;
    const guardKey = `engagement-autosync:${postId ?? 'all'}`;
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(guardKey)) return;
    try {
      sessionStorage.setItem(guardKey, '1');
    } catch {
      /* private mode — proceed without the guard */
    }
    handleSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, connected, isEmptyNow]);

  if (loading) {
    return (
      <div className={compact ? 'space-y-3' : 'space-y-6'}>
        {!compact && (
          <div className="space-y-2">
            <div className="h-8 w-48 bg-bg-tertiary rounded-md animate-pulse" />
            <div className="h-4 w-full max-w-md bg-bg-tertiary rounded animate-pulse" />
          </div>
        )}
        <div className="rounded-lg border border-border bg-bg-secondary p-6 shadow-card">
          <SkeletonLines count={4} />
        </div>
      </div>
    );
  }

  const groups = data?.groups ?? [];
  const summary = data?.summary;
  const isEmpty = groups.length === 0;

  return (
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
      {summary && !isEmpty && !compact && (
        <p className="font-mono text-[12px] tracking-[0.02em] text-ink3">
          {summary.comments} comment{summary.comments === 1 ? '' : 's'} across {summary.posts}{' '}
          post{summary.posts === 1 ? '' : 's'} · {summary.needs_reply} need
          {summary.needs_reply === 1 ? 's' : ''} a reply · {summary.drafted} drafted · {summary.sent}{' '}
          sent
        </p>
      )}

      <div className={`flex flex-wrap gap-2 ${compact ? '' : ''}`}>
        <Button
          variant="secondary"
          size="md"
          loading={syncing}
          onClick={handleSync}
          className="min-h-[44px]"
        >
          <RefreshCw className="h-4 w-4" />
          Sync comments
        </Button>
        <Button
          variant="secondary"
          size="md"
          loading={drafting}
          onClick={handleDraftReplies}
          className="min-h-[44px]"
        >
          <Sparkles className="h-4 w-4" />
          Draft replies
        </Button>
        <Button
          variant="primary"
          size="md"
          loading={sendingBulk}
          onClick={handleSendApproved}
          className="min-h-[44px]"
        >
          <Send className="h-4 w-4" />
          Send approved
        </Button>
      </div>

      {isEmpty ? (
        <div className="rounded-lg border border-border bg-bg-secondary p-8 md:p-10 text-center shadow-card">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-md bg-coral-light text-accent-primary mb-5">
            <MessageCircle className="h-7 w-7" strokeWidth={1.75} />
          </div>
          <h2 className="font-serif font-normal tracking-[-0.025em] text-ink text-[22px]">No comments yet</h2>
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
}: {
  group: InboxPostGroup;
  compact: boolean;
  draftEdits: Record<string, string>;
  sendingId: string | null;
  onDraftChange: (queueId: string, text: string) => void;
  onApproveSend: (item: InboxComment) => void;
}) {
  const needs = group.stats.needs_reply;
  const drafted = group.stats.drafted;

  return (
    <section className="rounded-lg border border-border bg-bg-secondary shadow-card overflow-hidden">
      <div className="px-4 py-3 border-b border-hair bg-bg-tertiary/60">
        <h2 className="font-serif font-normal tracking-[-0.025em] text-ink text-[18px] leading-tight">{group.post_title}</h2>
        <p className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink3">
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
          />
        ))}
      </ul>
    </section>
  );
}

function CommentRow({
  item,
  draftEdits,
  sendingId,
  onDraftChange,
  onApproveSend,
}: {
  item: InboxComment;
  draftEdits: Record<string, string>;
  sendingId: string | null;
  onDraftChange: (queueId: string, text: string) => void;
  onApproveSend: (item: InboxComment) => void;
}) {
  const { comment, queue } = item;
  const isSent = queue?.status === 'sent';
  const queueId = queue?.id;
  const draftValue =
    queueId != null
      ? (draftEdits[queueId] ?? queue?.draft_reply ?? '')
      : '';

  return (
    <li className="p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[13px] font-medium text-ink">{authorLabel(item)}</p>
          {comment.author_headline && (
            <p className="font-mono text-[11px] text-ink3 mt-0.5 line-clamp-1">{comment.author_headline}</p>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-badge text-xs font-medium ${statusTone(queue)}`}
        >
          {isSent ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : queue?.status === 'failed' ? (
            <AlertCircle className="h-3.5 w-3.5" />
          ) : (
            <Clock className="h-3.5 w-3.5" />
          )}
          {statusLabel(queue)}
        </span>
      </div>

      <blockquote className="text-[15px] text-text-primary leading-relaxed border-l-2 border-coral pl-3">
        {comment.comment_text}
      </blockquote>

      {!isSent && (
        <div className="space-y-2">
          <label className="block">
            <span className="section-label">
              Your reply
            </span>
            <Textarea
              rows={3}
              value={draftValue}
              disabled={!queueId}
              placeholder={
                queueId
                  ? 'Edit the draft reply…'
                  : 'Tap “Draft replies” to generate a reply in your voice'
              }
              onChange={(e) => queueId && onDraftChange(queueId, e.target.value)}
              className="mt-1.5 min-h-[44px]"
            />
          </label>
          {queue?.last_error && (
            <p className="text-xs text-accent-dark">{queue.last_error}</p>
          )}
          <Button
            variant="primary"
            size="md"
            className="w-full sm:w-auto min-h-[44px]"
            disabled={!queueId || !draftValue.trim()}
            loading={sendingId === queueId}
            onClick={() => onApproveSend(item)}
          >
            <Send className="h-4 w-4" />
            Approve &amp; Send
          </Button>
        </div>
      )}

      {isSent && queue?.draft_reply && (
        <p className="text-sm text-text-secondary bg-bg-tertiary rounded-md px-3 py-2">
          <span className="font-medium text-text-primary">You replied: </span>
          {queue.draft_reply}
        </p>
      )}
    </li>
  );
}
