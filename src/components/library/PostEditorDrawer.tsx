'use client';

import { useCallback, useEffect, useState } from 'react';
import { X, Wand2, Copy, MonitorPlay, Trash2, Clock, BarChart3 } from 'lucide-react';
import type { Post, Series } from '@/lib/types';
import { postPillars, pillarWeights } from '@/lib/pillars';
import type { Status, DashboardPlatform } from '@/lib/constants';
import { PLATFORMS, PLATFORM_LABELS, STATUSES, STATUS_LABELS, normalizeDashboardPlatform } from '@/lib/constants';
import PillarMultiSelect from '@/components/ui/PillarMultiSelect';
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

const EngagementInbox = dynamic(() => import('@/components/engagement/EngagementInbox'), {
  ssr: false,
  loading: () => (
    <div className="rounded-lg border border-border bg-bg-secondary p-4 animate-pulse h-24" />
  ),
});
import { useToast } from '@/components/ui/Toast';
import { ImageUpload } from '@/components/ui/ImageUpload';
import { CharCount } from '@/components/ui/CharCount';
import { PlatformConstraints } from '@/components/ui/PlatformConstraints';
import { Tabs } from '@/components/ui/Tabs';
import Link from 'next/link';

const DRAWER_TABS = [
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
  const [activeTab, setActiveTab] = useState<DrawerTab>('write');
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
  // Bumped after linking a live post URL, to remount EngagementInbox so it
  // re-fetches (its auto-sync fires on an empty, now-linked post).
  const [inboxKey, setInboxKey] = useState(0);
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
    if (!confirm('Remove this post from the tool? (Your live LinkedIn/X post is not affected.)')) return;
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
  function handlePillarsChange(next: { pillars: string[]; weights: Record<string, number> }) {
    setForm((f) => ({ ...f, pillars: next.pillars, pillar: next.pillars[0], pillar_weights: next.weights }));
    void persistPillars(next.pillars, next.weights);
  }

  /** PATCH just the pillars (synced primary + weights) for this post. */
  async function persistPillars(pillars: string[], weights: Record<string, number>) {
    try {
      const res = await fetchWithAuth(`/api/posts/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pillars,
          pillar: pillars[0],
          pillar_weights: weights,
          updated_at: new Date().toISOString(),
        }),
      });
      if (res.ok) onSave();
      else toast('Save failed', 'error');
    } catch {
      toast('Save failed', 'error');
    }
  }

  const inputClass =
    'w-full bg-bg-secondary border border-border rounded-md px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-border-hover transition-colors min-h-[44px]';
  const labelClass = 'text-[11px] text-text-secondary mb-1 block font-medium tracking-wide';

  const isPosted = form.status === 'posted';

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/40" onClick={onClose} />

      {/* Centered modal window (was a right-side drawer). Opens as a large
          overlay so a post gets a full editing surface, not a cramped rail. */}
      <div className="fixed inset-0 z-[65] flex items-start justify-center overflow-y-auto p-4 sm:p-6" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
          className="relative my-auto w-full max-w-3xl max-h-[90vh] rounded-2xl bg-bg-primary border border-border shadow-2xl overflow-hidden flex flex-col"
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

        {/* Preview-first for a published post: show it as it looks on the
            platform, so the user recognizes their post at a glance before the
            edit fields / comments / stats tabs below. */}
        {isPosted && (
          <div className="shrink-0 px-4 pt-4 bg-bg-secondary border-b border-border">
            <PostSocialPreview
              platform={normalizeDashboardPlatform(form.platform)}
              name={author.name}
              headline={author.headline}
              text={form.script || form.caption || form.hook || ''}
              imageUrl={form.image_url || null}
            />
          </div>
        )}

        <div className="shrink-0 px-4 pt-3 bg-bg-secondary border-b border-border">
          <Tabs tabs={[...DRAWER_TABS]} activeTab={activeTab} onChange={(id) => setActiveTab(id as DrawerTab)} />
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-bg-primary">
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

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Imported (historical) posts aren't authored against a pillar — hide the picker. */}
                {!post.is_imported && (
                  <div className="block sm:col-span-3">
                    <span className={labelClass}>Pillars (pick one or more)</span>
                    <PillarMultiSelect
                      pillars={form.pillars}
                      weights={form.pillar_weights}
                      onChange={handlePillarsChange}
                    />
                  </div>
                )}
                <label className="block">
                  <span className={labelClass}>Platform</span>
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
                </label>
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

              {isLinkedIn && (
                <div>
                  <span className={labelClass}>LinkedIn preview</span>
                  <LinkedInPostPreview
                    name={author.name}
                    headline={author.headline}
                    text={form.script || form.caption || ''}
                    imageUrl={form.image_url || null}
                  />
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
                <span className={labelClass}>{isLinkedIn ? 'Post body' : 'Script'}</span>
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
                {form.series_id && (
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
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2">
                {!isLinkedIn && (
                  <button
                    type="button"
                    onClick={() => handleRegenerate('caption')}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] text-[13px] text-text-primary bg-bg-secondary border border-border rounded-md hover:bg-bg-tertiary transition-colors"
                  >
                    <Wand2 size={14} /> Regenerate Caption
                  </button>
                )}
                {!isLinkedIn && (
                  <button
                    type="button"
                    onClick={() => handleRegenerate('hook')}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] text-[13px] text-text-primary bg-bg-secondary border border-border rounded-md hover:bg-bg-tertiary transition-colors"
                  >
                    <Wand2 size={14} /> Regenerate Hook
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (form.script) {
                      navigator.clipboard.writeText(form.script);
                      toast('Script copied for repurpose');
                    }
                  }}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] text-[13px] text-text-primary bg-bg-secondary border border-border rounded-md hover:bg-bg-tertiary transition-colors"
                >
                  <Copy size={14} /> Repurpose
                </button>
                <Link
                  href={`/teleprompter?postId=${post.id}`}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] text-[13px] text-text-primary bg-bg-secondary border border-border rounded-md hover:bg-bg-tertiary transition-colors"
                >
                  <MonitorPlay size={14} /> Teleprompter
                </Link>
              </div>

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
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 text-[13px] text-accent-primary hover:text-accent-dark transition-colors mt-2 min-h-[44px]"
              >
                <Trash2 size={14} /> Delete Post
              </button>
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
              {isPosted && !post.publish_job_id && (
                <LinkLivePostBanner
                  postId={post.id}
                  platform={normalizeDashboardPlatform(form.platform)}
                  onLinked={() => {
                    setInboxKey((k) => k + 1);
                    onSave();
                  }}
                />
              )}
              <EngagementInbox key={inboxKey} postId={post.id} compact />
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

        <div className="shrink-0 border-t border-border p-4 bg-bg-secondary">
          <StatusPipeline current={form.status} onChange={handleStatusChange} />
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
 * Shown in the Comments tab for a posted post that was never published/linked
 * through the app (an "old" post, so no publish_jobs row and no comments). The
 * user pastes the live post URL; the server resolves the provider post id and
 * links it, unlocking comment + reaction sync.
 */
function LinkLivePostBanner({
  postId,
  platform,
  onLinked,
}: {
  postId: string;
  platform: DashboardPlatform;
  onLinked: () => void;
}) {
  const { toast } = useToast();
  const [url, setUrl] = useState('');
  const [linking, setLinking] = useState(false);
  const label = platform === 'linkedin' ? 'LinkedIn' : platform === 'twitter' ? 'X' : 'post';

  async function link() {
    if (!url.trim()) return;
    setLinking(true);
    try {
      const res = await fetchWithAuth(`/api/posts/${postId}/link-live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Could not link the post.');
      toast('Linked. Hit Sync to pull in the comments.');
      onLinked();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not link the post.', 'error');
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-border bg-bg-secondary p-3 space-y-2">
      <p className="text-[13px] font-medium text-text-primary">Pull in this post&apos;s comments</p>
      <p className="text-[12px] text-text-secondary">
        This post was published outside the app, so paste its {label} URL to load the real comments
        and replies here.
      </p>
      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void link(); }}
          placeholder={platform === 'twitter' ? 'https://x.com/you/status/…' : 'https://www.linkedin.com/feed/update/…'}
          className="flex-1 rounded-md border border-border bg-bg-primary px-3 py-2 text-[13px] text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
        />
        <button
          type="button"
          onClick={() => void link()}
          disabled={linking || !url.trim()}
          className="shrink-0 rounded-md bg-accent-primary px-4 text-[13px] font-medium text-text-inverse hover:bg-accent-dark disabled:opacity-50"
        >
          {linking ? 'Linking…' : 'Link'}
        </button>
      </div>
    </div>
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
}: {
  platform: DashboardPlatform;
  name: string;
  headline?: string | null;
  text: string;
  imageUrl?: string | null;
}) {
  if (platform === 'linkedin') {
    return <LinkedInPostPreview name={name} headline={headline} text={text} imageUrl={imageUrl} />;
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
