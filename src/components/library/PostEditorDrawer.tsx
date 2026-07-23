'use client';

import { useCallback, useEffect, useState } from 'react';
import { X, Wand2, Copy, MonitorPlay, Trash2, Clock, BarChart3 } from 'lucide-react';
import type { Post, Series } from '@/lib/types';
import { postPillars, pillarWeights } from '@/lib/pillars';
import type { Status, DashboardPlatform } from '@/lib/constants';
import { PLATFORMS, PLATFORM_LABELS, STATUSES, STATUS_LABELS, normalizeDashboardPlatform } from '@/lib/constants';
import StatusPipeline from '@/components/library/StatusPipeline';
import PerformanceModal from '@/components/library/PerformanceModal';
import PublishPanel from '@/components/library/PublishPanel';
import GenerateVariantsSection from '@/components/library/GenerateVariantsSection';
import BulkPublishPanel from '@/components/library/BulkPublishPanel';
import { LinkedInPostPreview } from '@/components/generate/LinkedInPostPreview';
import { getInitials } from '@/lib/compose-preview';
import dynamic from 'next/dynamic';
import { logEditFeedback } from '@/lib/hooks-intelligence/edit-feedback';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { shortAge } from '@/lib/utils';

const EngagementInbox = dynamic(() => import('@/components/engagement/EngagementInbox'), {
  ssr: false,
  loading: () => (
    // Matches the inbox's own skeleton height so the chunk load and the data
    // load read as one continuous "loading", not two different placeholders.
    <div className="rounded-lg border border-border bg-bg-secondary p-4 animate-pulse h-40" />
  ),
});
import { useToast } from '@/components/ui/Toast';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { ImageUpload } from '@/components/ui/ImageUpload';
import { CharCount } from '@/components/ui/CharCount';
import { PlatformConstraints } from '@/components/ui/PlatformConstraints';
import { Tabs } from '@/components/ui/Tabs';
import Link from 'next/link';

const DRAWER_TABS = [
  { id: 'preview', label: 'Preview' },
  { id: 'write', label: 'Write' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'comments', label: 'Comments' },
  { id: 'stats', label: 'Stats' },
] as const;

type DrawerTab = (typeof DRAWER_TABS)[number]['id'];

interface PostEditorDrawerProps {
  post: Post;
  series: Series[];
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}

export default function PostEditorDrawer({ post, series, onClose, onSave, onDelete }: PostEditorDrawerProps) {
  const { toast } = useToast();
  // Preview opens first: for a published post the card is the answer to "what
  // is this?", and the edit fields are the follow-up.
  const [activeTab, setActiveTab] = useState<DrawerTab>('preview');
  const [form, setForm] = useState({
    title: post.title,
    pillar: post.pillar,
    pillars: postPillars(post),
    pillar_weights: pillarWeights(post),
    platform: post.platform,
    status: post.status,
    scheduled_date: post.scheduled_date ?? '',
    scheduled_publish_at: post.scheduled_publish_at ?? '',
    hook: post.hook ?? '',
    script: post.script ?? '',
    caption: post.caption ?? '',
    hashtags: post.hashtags ?? '',
    notes: post.notes ?? '',
    series_id: post.series_id ?? '',
    series_position: post.series_position ?? 1,
    image_url: post.image_url ?? '',
    posted_date: post.posted_date ?? '',
    views: post.views ?? 0,
    likes: post.likes ?? 0,
    saves: post.saves ?? 0,
    comments: post.comments ?? 0,
    shares: post.shares ?? 0,
    follows_gained: post.follows_gained ?? 0,
    voice_match_score: post.voice_match_score ?? null,
    ai_score: post.ai_score ?? null,
  });
  const [showPerfModal, setShowPerfModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Bumped after linking a live post URL, to remount EngagementInbox so it
  // re-fetches (its auto-sync fires on an empty, now-linked post).
  // Footer slot the Comments tab portals its Sync/Draft/Send row into, so those
  // actions sit beside the status pipeline instead of scrolling with the list.
  const [commentActionsSlot, setCommentActionsSlot] = useState<HTMLDivElement | null>(null);
  // Top comments for the Write-tab preview, so the card shows what the post
  // actually looks like in the feed rather than a version with no discussion.
  const [previewComments, setPreviewComments] = useState<{
    top: Array<{ id: string; author: string; headline?: string | null; text: string; age?: string | null }>;
    total: number;
  }>({ top: [], total: 0 });

  useEffect(() => {
    let cancelled = false;
    fetchWithAuth(`/api/engagement/inbox?postId=${post.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const group = (data.groups ?? [])[0];
        if (!group) return;
        setPreviewComments({
          total: group.stats?.total ?? group.comments.length,
          top: group.comments.slice(0, 2).map((c: { comment: { id: string; author_name: string | null; author_handle: string | null; author_headline: string | null; comment_text: string; commented_at: string | null } }) => ({
            id: c.comment.id,
            author: c.comment.author_name ?? c.comment.author_handle ?? 'Someone',
            headline: c.comment.author_headline,
            text: c.comment.comment_text,
            age: c.comment.commented_at ? shortAge(c.comment.commented_at) : null,
          })),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [post.id]);
  // Author identity for the LinkedIn-style preview (LinkedIn posts only).
  const [author, setAuthor] = useState<{ name: string; headline: string | null }>({ name: 'You', headline: null });

  const isLinkedIn = form.platform === 'linkedin';

  useEffect(() => {
    if (!isLinkedIn) return;
    fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.profile?.displayName) {
          setAuthor({ name: data.profile.displayName, headline: data.profile.headline ?? null });
        }
      })
      .catch(() => {});
  }, [isLinkedIn]);

  useEffect(() => {
    setForm({
      title: post.title,
      pillar: post.pillar,
      pillars: postPillars(post),
      pillar_weights: pillarWeights(post),
      platform: post.platform,
      status: post.status,
      scheduled_date: post.scheduled_date ?? '',
      scheduled_publish_at: post.scheduled_publish_at ?? '',
      hook: post.hook ?? '',
      script: post.script ?? '',
      caption: post.caption ?? '',
      hashtags: post.hashtags ?? '',
      notes: post.notes ?? '',
      series_id: post.series_id ?? '',
      series_position: post.series_position ?? 1,
      image_url: post.image_url ?? '',
      posted_date: post.posted_date ?? '',
      views: post.views ?? 0,
      likes: post.likes ?? 0,
      saves: post.saves ?? 0,
      comments: post.comments ?? 0,
      shares: post.shares ?? 0,
      follows_gained: post.follows_gained ?? 0,
      voice_match_score: post.voice_match_score ?? null,
      ai_score: post.ai_score ?? null,
    });
  }, [post]);

  const autoSave = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/posts/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          series_id: form.series_id || null,
          scheduled_date: form.scheduled_date || null,
          scheduled_publish_at: form.scheduled_publish_at || null,
          image_url: form.image_url || null,
          posted_date: form.posted_date || null,
          voice_match_score: form.voice_match_score ?? null,
          ai_score: form.ai_score ?? null,
          updated_at: new Date().toISOString(),
        }),
      });
      if (res.ok) {
        toast('Saved');
        onSave();

        // Replicate useful "continuous learning from edits" pattern (inspired by Imagine trial)
        // Log significant human edits vs original AI version to improve Hook Intelligence / voice over time
        logEditFeedback({
          postId: post.id,
          originalContent: {
            hook: post.hook || '',
            script: post.script || '',
            caption: post.caption || '',
          },
          editedContent: {
            hook: form.hook,
            script: form.script,
            caption: form.caption,
          },
          pillar: form.pillar,
          platform: form.platform,
        });
      }
    } catch {
      toast('Save failed', 'error');
    }
  }, [form, onSave, toast, post]);

  const handleStatusChange = async (status: Status) => {
    if (status === 'posted' && form.status !== 'posted') {
      setForm((f) => ({ ...f, status }));
      setShowPerfModal(true);
      return;
    }
    setForm((f) => ({ ...f, status }));
    try {
      const res = await fetchWithAuth(`/api/posts/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
      });
      if (res.ok) {
        toast('Status updated');
        onSave();
      }
    } catch {
      toast('Update failed', 'error');
    }
  };

  const handlePerfSave = async (data: Record<string, unknown>) => {
    try {
      const res = await fetchWithAuth(`/api/posts/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        toast('Performance logged');
        setShowPerfModal(false);
        setForm((f) => ({
          ...f,
          ...data,
          status: 'posted' as Status,
        }));
        onSave();
      }
    } catch {
      toast('Save failed', 'error');
    }
  };

  const handleDelete = async () => {
    // Deletes ONLY the tool's post row (InsForge). Does NOT touch the live
    // LinkedIn/X post - the DELETE route makes no provider call.
    setDeleting(true);
    try {
      // fetchWithAuth so an expired access token refreshes+retries instead of
      // 401ing; and check res.ok so a failed delete never falsely reports success
      // (the old plain fetch() toasted "deleted" then the post reappeared).
      const res = await fetchWithAuth(`/api/posts/${post.id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast('Delete failed', 'error');
        setDeleting(false);
        return;
      }
      toast('Post removed from the tool');
      onDelete();
    } catch {
      toast('Delete failed', 'error');
      setDeleting(false);
    }
  };

  const handleRegenerate = async (field: 'caption' | 'hook') => {
    const prompt = field === 'caption'
      ? `Write a social media caption for this script. Be concise, punchy, no em dashes:\n\n${form.script}`
      : `Write a strong hook (first line) for this content. No em dashes:\n\n${form.script}`;
    try {
      const res = await fetchWithAuth('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (res.ok) {
        const data = await res.json();
        setForm((f) => ({ ...f, [field]: data.text }));
        toast(`${field === 'caption' ? 'Caption' : 'Hook'} regenerated`);
      }
    } catch {
      toast('Generation failed', 'error');
    }
  };

  function update(key: string, value: string | number) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /**
   * Toggle a pillar in the multi-select; keeps primary `pillar` as pillars[0] and
   * persists immediately (buttons have no onBlur). Persists the COMPUTED next
   * value to avoid saving stale closure state.
   */
  /**
   * Apply a pillar selection + weights change from the picker and persist it.
   * `pillars` arrives primary-first, so pillars[0] is the synced primary.
   */
  const inputClass =
    'w-full bg-bg-secondary border border-border rounded-md px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-border-hover transition-colors min-h-[44px]';
  const labelClass = 'text-[11px] text-text-secondary mb-1 block font-medium tracking-wide';

  const isPosted = form.status === 'posted';

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/40" onClick={onClose} />

      {/* Centered modal window (was a right-side drawer). Opens as a large
          overlay so a post gets a full editing surface, not a cramped rail. */}
      {/* One scroll container, and only one: the shell is capped to the padded
          viewport (`max-h-full`) so the body pane below is the single thing that
          scrolls. The old `overflow-y-auto` here plus a `90vh` shell meant the
          wheel chained between two scrollers and the modal could still outgrow
          the screen. */}
      <div className="fixed inset-0 z-[65] flex items-center justify-center p-4 sm:p-6" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-5xl max-h-full rounded-2xl bg-bg-primary border border-border shadow-2xl overflow-hidden flex flex-col"
        >
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0 bg-bg-secondary">
          <h2 className="font-heading text-lg font-bold text-text-primary truncate pr-2">
            {form.title || 'Edit post'}
          </h2>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Publish sits in the tab row, not buried in the Schedule tab: it is
            the action people come here to take, and it used to be a scroll away
            inside another tab. Hidden once the post is live. */}
        <div className="shrink-0 flex items-end justify-between gap-3 px-4 pt-3 bg-bg-secondary border-b border-border">
          <Tabs tabs={[...DRAWER_TABS]} activeTab={activeTab} onChange={(id) => setActiveTab(id as DrawerTab)} />
          {!isPosted && (
            <div className="pb-2">
              <PublishPanel
                compact
                postId={post.id}
                content={form.script || form.hook || form.title}
                caption={form.caption}
                onPublishSuccess={() => {
                  setForm((f) => ({ ...f, status: 'posted' }));
                  toast('Published! Post status updated.');
                  onSave();
                }}
              />
            </div>
          )}
        </div>

        {/* `min-h-0` is load-bearing: a flex item defaults to `min-height: auto`,
            so without it this pane refuses to shrink below its content height.
            The pane then overflowed the `max-h-[90vh]` shell, `overflow-hidden`
            clipped the excess, and `overflow-y-auto` was left scrolling a sliver
            a couple of lines tall. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4 bg-bg-primary">
          {activeTab === 'preview' && (
            <PostSocialPreview
              platform={normalizeDashboardPlatform(form.platform)}
              name={author.name}
              headline={author.headline}
              text={form.script || form.caption || form.hook || ''}
              imageUrl={form.image_url || null}
              imageUrls={(post.images ?? []).map((i) => i.url)}
              videoUrl={post.video_url ?? null}
              reactions={form.likes}
              comments={form.comments}
              reposts={form.shares}
              repost={post.reposted_content ?? null}
              topComments={previewComments.top}
              totalComments={previewComments.total}
            />
          )}

          {activeTab === 'write' && (
            <>

              <label className="block">
                <span className={labelClass}>Title</span>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => update('title', e.target.value)}
                  onBlur={autoSave}
                  className={inputClass}
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Where a live post went out is a fact, not a setting. Offering
                    "X" on a post that was published to LinkedIn invited an edit
                    that would make the row lie about its own history. */}
                <div className="block">
                  <span className={labelClass}>Platform</span>
                  {isPosted ? (
                    <p className={`${inputClass} flex items-center bg-bg-tertiary text-text-secondary`}>
                      {PLATFORM_LABELS[normalizeDashboardPlatform(form.platform)]}
                    </p>
                  ) : (
                    <select
                      value={form.platform}
                      onChange={(e) => update('platform', e.target.value)}
                      onBlur={autoSave}
                      className={inputClass}
                    >
                      {PLATFORMS.map((p) => (
                        <option key={p} value={p}>
                          {PLATFORM_LABELS[p]}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <label className="block">
                  <span className={labelClass}>Status</span>
                  <select
                    value={form.status}
                    onChange={(e) => handleStatusChange(e.target.value as Status)}
                    className={inputClass}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Media and its limits only matter while the post can still
                  change. On a live post, swapping the image would update our
                  row and nothing on LinkedIn, and the media is already visible
                  in the preview above - so there is nothing to show here. */}
              {!isPosted && (
                <>
                  <div>
                    <span className={labelClass}>Image</span>
                    <ImageUpload
                      imageUrl={form.image_url || null}
                      onUpload={(url) => {
                        update('image_url', url);
                        setTimeout(autoSave, 100);
                      }}
                      onRemove={() => {
                        update('image_url', '');
                        setTimeout(autoSave, 100);
                      }}
                    />
                  </div>

                  <PlatformConstraints platform={form.platform} hasImage={Boolean(form.image_url)} compact />
                </>
              )}

              {(form.voice_match_score != null || form.ai_score != null) && (
                <div className="rounded-md border border-border bg-bg-secondary p-3 text-[13px]">
                  <div className="text-[11px] font-medium text-text-tertiary mb-1.5">Voice QA (from generation)</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {form.voice_match_score != null && (
                      <span className={form.voice_match_score >= 80 ? 'text-accent-secondary' : 'text-accent-primary'}>
                        Voice match: <span className="font-semibold">{form.voice_match_score}</span>%
                      </span>
                    )}
                    {form.ai_score != null && (
                      <span className={form.ai_score <= 30 ? 'text-accent-secondary' : 'text-text-secondary'}>
                        AI tells: <span className="font-semibold">{form.ai_score}</span>/100
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] text-text-tertiary">Scores captured at generation time via voice pipeline + evaluator.</p>
                </div>
              )}

              {!isLinkedIn && (
                <label className="block">
                  <span className={labelClass}>Hook</span>
                  <textarea
                    rows={3}
                    value={form.hook}
                    onChange={(e) => update('hook', e.target.value)}
                    onBlur={autoSave}
                    className={`${inputClass} resize-none min-h-[88px]`}
                  />
                </label>
              )}

              <label className="block">
                <div className="flex items-center justify-between">
                  <span className={labelClass}>{isLinkedIn ? 'Post body' : 'Script'}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!form.script) return;
                      navigator.clipboard.writeText(form.script);
                      toast('Post body copied');
                    }}
                    className="flex cursor-pointer items-center gap-1 text-[11px] font-medium text-text-secondary transition-colors hover:text-text-primary"
                  >
                    <Copy size={12} /> Copy
                  </button>
                </div>
                <textarea
                  rows={10}
                  value={form.script}
                  onChange={(e) => update('script', e.target.value)}
                  onBlur={autoSave}
                  className={`${inputClass} resize-none`}
                />
              </label>

              {!isLinkedIn && (
                <>
                  <label className="block">
                    <div className="flex items-center justify-between">
                      <span className={labelClass}>Caption</span>
                      <CharCount text={form.caption} platform={form.platform} />
                    </div>
                    <textarea
                      rows={5}
                      value={form.caption}
                      onChange={(e) => update('caption', e.target.value)}
                      onBlur={autoSave}
                      className={`${inputClass} resize-none`}
                    />
                  </label>

                  <label className="block">
                    <span className={labelClass}>Hashtags</span>
                    <textarea
                      rows={3}
                      value={form.hashtags}
                      onChange={(e) => update('hashtags', e.target.value)}
                      onBlur={autoSave}
                      className={`${inputClass} resize-none`}
                    />
                  </label>
                </>
              )}

              <label className="block">
                <span className={labelClass}>Notes</span>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => update('notes', e.target.value)}
                  onBlur={autoSave}
                  className={`${inputClass} resize-none`}
                />
              </label>

              {/* Teleprompter shares the Series row: with no series selected the
                  second column was empty, so it sat in a button strip below
                  wasting a whole row. When a series IS selected, Position takes
                  the second column and Teleprompter moves under it. */}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={labelClass}>Series</span>
                  <select
                    value={form.series_id}
                    onChange={(e) => update('series_id', e.target.value)}
                    onBlur={autoSave}
                    className={inputClass}
                  >
                    <option value="">None</option>
                    {series.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                {form.series_id ? (
                  <label className="block">
                    <span className={labelClass}>Position</span>
                    <input
                      type="number"
                      min={1}
                      value={form.series_position}
                      onChange={(e) => update('series_position', parseInt(e.target.value) || 1)}
                      onBlur={autoSave}
                      className={inputClass}
                    />
                  </label>
                ) : (
                  <div className="block">
                    <span className={labelClass}>&nbsp;</span>
                    <Link
                      href={`/teleprompter?postId=${post.id}`}
                      className={`${inputClass} flex items-center justify-center gap-1.5 hover:bg-bg-tertiary transition-colors`}
                    >
                      <MonitorPlay size={14} /> Teleprompter
                    </Link>
                  </div>
                )}
              </div>

              {form.series_id && (
                <Link
                  href={`/teleprompter?postId=${post.id}`}
                  className={`${inputClass} flex items-center justify-center gap-1.5 hover:bg-bg-tertiary transition-colors`}
                >
                  <MonitorPlay size={14} /> Teleprompter
                </Link>
              )}

              {!isLinkedIn && (
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => handleRegenerate('caption')}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] text-[13px] text-text-primary bg-bg-secondary border border-border rounded-md hover:bg-bg-tertiary transition-colors"
                  >
                    <Wand2 size={14} /> Regenerate Caption
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRegenerate('hook')}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] text-[13px] text-text-primary bg-bg-secondary border border-border rounded-md hover:bg-bg-tertiary transition-colors"
                  >
                    <Wand2 size={14} /> Regenerate Hook
                  </button>
                </div>
              )}

              <GenerateVariantsSection
                content={form.script || form.caption || form.hook || form.title}
                sourcePlatform={normalizeDashboardPlatform(form.platform)}
                postId={post.id}
                onReplaceCaption={(newCaption: string) => {
                  setForm((f) => ({ ...f, caption: newCaption }));
                  autoSave();
                }}
              />

              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                disabled={deleting}
                className="flex items-center gap-1.5 text-[13px] text-accent-primary hover:text-accent-dark transition-colors mt-2 min-h-[44px]"
              >
                <Trash2 size={14} /> Delete Post
              </button>
              <ConfirmModal
                open={deleteOpen}
                title="Remove post"
                message="Remove this post from the tool? Your live LinkedIn/X post is not affected."
                confirmLabel="Remove"
                tone="danger"
                loading={deleting}
                onConfirm={() => void handleDelete()}
                onClose={() => setDeleteOpen(false)}
              />
            </>
          )}

          {activeTab === 'schedule' && (
            <>
              <label className="block">
                <span className={labelClass}>Scheduled date</span>
                <input
                  type="date"
                  value={form.scheduled_date}
                  onChange={(e) => update('scheduled_date', e.target.value)}
                  onBlur={autoSave}
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className={`${labelClass} flex items-center gap-1`}>
                  <Clock size={12} />
                  Auto-publish at
                </span>
                <input
                  type="datetime-local"
                  value={form.scheduled_publish_at ? form.scheduled_publish_at.slice(0, 16) : ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    update('scheduled_publish_at', val ? new Date(val).toISOString() : '');
                  }}
                  onBlur={autoSave}
                  className={inputClass}
                />
                <span className="text-xs text-text-tertiary mt-1 block">
                  Cron will publish this post at the date and time you set.
                </span>
              </label>

              <div className="pt-2">
                <span className="text-[10px] font-medium tracking-[0.01em] text-text-tertiary">
                  Publish
                </span>
              </div>

              <PublishPanel
                publishedTo={isPosted ? form.platform : null}
                postId={post.id}
                content={form.script || form.hook || form.title}
                caption={form.caption}
                onPublishSuccess={() => {
                  setForm((f) => ({ ...f, status: 'posted' }));
                  toast('Published! Post status updated.');
                  onSave();
                }}
              />

              <div className="pt-2">
                <span className="text-[10px] font-medium tracking-[0.01em] text-text-tertiary">
                  Bulk publish
                </span>
              </div>

              <BulkPublishPanel
                publishedTo={isPosted ? form.platform : null}
                postId={post.id}
                content={form.script || form.hook || form.title}
                caption={form.caption}
                onPublishSuccess={() => {
                  setForm((f) => ({ ...f, status: 'posted' }));
                  toast('Published! Post status updated.');
                  onSave();
                }}
              />
            </>
          )}

          {activeTab === 'comments' && (
            <>
              <EngagementInbox
                postId={post.id}
                compact
                actionsPortal={commentActionsSlot}
              />
            </>
          )}

          {activeTab === 'stats' && (
            <>
              {!isPosted ? (
                <div className="rounded-lg border border-dashed border-border bg-bg-secondary p-6 text-center">
                  <BarChart3 className="h-8 w-8 text-text-tertiary mx-auto mb-3" />
                  <p className="text-sm font-medium text-text-primary">Not published yet</p>
                  <p className="mt-2 text-sm text-text-secondary leading-relaxed">
                    Mark this post as posted or publish from the Schedule tab to log views, likes,
                    and other performance numbers.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowPerfModal(true)}
                    className="mt-4 inline-flex items-center justify-center min-h-[44px] px-5 rounded-md text-[15px] font-medium bg-accent-primary text-text-inverse hover:bg-accent-dark transition-colors"
                  >
                    Log performance anyway
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-text-secondary">
                    How this post performed after you published it.
                  </p>
                  <label className="block">
                    <span className={labelClass}>Posted date</span>
                    <input
                      type="date"
                      value={form.posted_date}
                      onChange={(e) => update('posted_date', e.target.value)}
                      onBlur={autoSave}
                      className={inputClass}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <StatField
                      label="Views"
                      value={form.views}
                      onChange={(v) => update('views', v)}
                      onBlur={autoSave}
                      inputClass={inputClass}
                      labelClass={labelClass}
                    />
                    <StatField
                      label="Likes"
                      value={form.likes}
                      onChange={(v) => update('likes', v)}
                      onBlur={autoSave}
                      inputClass={inputClass}
                      labelClass={labelClass}
                    />
                    <StatField
                      label="Saves"
                      value={form.saves}
                      onChange={(v) => update('saves', v)}
                      onBlur={autoSave}
                      inputClass={inputClass}
                      labelClass={labelClass}
                    />
                    <StatField
                      label="Comments"
                      value={form.comments}
                      onChange={(v) => update('comments', v)}
                      onBlur={autoSave}
                      inputClass={inputClass}
                      labelClass={labelClass}
                    />
                    <StatField
                      label="Shares"
                      value={form.shares}
                      onChange={(v) => update('shares', v)}
                      onBlur={autoSave}
                      inputClass={inputClass}
                      labelClass={labelClass}
                    />
                    <StatField
                      label="Follows gained"
                      value={form.follows_gained}
                      onChange={(v) => update('follows_gained', v)}
                      onBlur={autoSave}
                      inputClass={inputClass}
                      labelClass={labelClass}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-border p-4 bg-bg-secondary flex items-center justify-between gap-3">
          <div className="min-w-0 overflow-x-auto">
            <StatusPipeline current={form.status} onChange={handleStatusChange} />
          </div>
          <div ref={setCommentActionsSlot} />
        </div>
        </div>
      </div>

      {showPerfModal && (
        <PerformanceModal post={post} onSave={handlePerfSave} onClose={() => setShowPerfModal(false)} />
      )}
    </>
  );
}

/**
 * Renders a posted post the way it looks on the platform it went out on:
 * the LinkedIn feed card for LinkedIn, a compact X-style card otherwise. Shown
 * at the top of the modal for published posts so the user recognizes the post
 * before the edit fields below.
 */
function PostSocialPreview({
  platform,
  name,
  headline,
  text,
  imageUrl,
  imageUrls,
  videoUrl,
  reactions,
  comments,
  reposts,
  repost,
  topComments,
  totalComments,
}: {
  platform: DashboardPlatform;
  name: string;
  headline?: string | null;
  text: string;
  imageUrl?: string | null;
  imageUrls?: string[];
  videoUrl?: string | null;
  reactions?: number;
  comments?: number;
  reposts?: number;
  repost?: Post['reposted_content'];
  topComments?: Array<{ id: string; author: string; headline?: string | null; text: string; age?: string | null }>;
  totalComments?: number;
}) {
  if (platform === 'linkedin') {
    return (
      <LinkedInPostPreview
        name={name}
        headline={headline}
        text={text}
        imageUrl={imageUrl}
        imageUrls={imageUrls}
        videoUrl={videoUrl}
        reactions={reactions}
        comments={comments}
        reposts={reposts}
        repost={repost}
        topComments={topComments}
        totalComments={totalComments}
      />
    );
  }
  // X / other: minimal tweet-style card.
  return (
    <div className="rounded-xl border border-border bg-bg-primary p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-tertiary text-[13px] font-semibold text-text-secondary">
          {getInitials(name)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-text-primary">{name}</p>
          {headline && <p className="truncate text-[12px] text-text-tertiary">{headline}</p>}
        </div>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed text-text-primary">{text}</p>
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="mt-3 w-full rounded-lg border border-border object-cover" />
      )}
    </div>
  );
}

function StatField({
  label,
  value,
  onChange,
  onBlur,
  inputClass,
  labelClass,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onBlur: () => void;
  inputClass: string;
  labelClass: string;
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        onBlur={onBlur}
        className={inputClass}
      />
    </label>
  );
}
