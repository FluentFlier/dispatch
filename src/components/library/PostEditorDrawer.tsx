'use client';

import { useCallback, useEffect, useState } from 'react';
import { X, Wand2, Copy, MonitorPlay, Trash2, Clock, BarChart3 } from 'lucide-react';
import type { Post, Series } from '@/lib/types';
import { postPillars } from '@/lib/pillars';
import type { Status, Platform } from '@/lib/constants';
import { PLATFORMS, STATUSES, STATUS_LABELS } from '@/lib/constants';
import { usePillars } from '@/hooks/usePillars';
import StatusPipeline from '@/components/library/StatusPipeline';
import PerformanceModal from '@/components/library/PerformanceModal';
import PublishPanel from '@/components/library/PublishPanel';
import GenerateVariantsSection from '@/components/library/GenerateVariantsSection';
import BulkPublishPanel from '@/components/library/BulkPublishPanel';
import dynamic from 'next/dynamic';
import { logEditFeedback } from '@/lib/hooks-intelligence/edit-feedback';

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
  const { pillars: pillarList } = usePillars();
  const [activeTab, setActiveTab] = useState<DrawerTab>('write');
  const [form, setForm] = useState({
    title: post.title,
    pillar: post.pillar,
    pillars: postPillars(post),
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

  useEffect(() => {
    setForm({
      title: post.title,
      pillar: post.pillar,
      pillars: postPillars(post),
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
      const res = await fetch(`/api/posts/${post.id}`, {
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
  }, [form, post.id, onSave, toast, post]);

  const handleStatusChange = async (status: Status) => {
    if (status === 'posted' && form.status !== 'posted') {
      setForm((f) => ({ ...f, status }));
      setShowPerfModal(true);
      return;
    }
    setForm((f) => ({ ...f, status }));
    try {
      const res = await fetch(`/api/posts/${post.id}`, {
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
      const res = await fetch(`/api/posts/${post.id}`, {
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
    if (!confirm('Delete this post?')) return;
    setDeleting(true);
    try {
      await fetch(`/api/posts/${post.id}`, { method: 'DELETE' });
      toast('Post deleted');
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
      const res = await fetch('/api/generate', {
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
  function togglePillar(value: string) {
    const has = form.pillars.includes(value);
    const next = has ? form.pillars.filter((p) => p !== value) : [...form.pillars, value];
    const pillars = next.length > 0 ? next : [value]; // never empty
    setForm((f) => ({ ...f, pillars, pillar: pillars[0] }));
    void persistPillars(pillars);
  }

  /** PATCH just the pillars (and synced primary) for this post. */
  async function persistPillars(pillars: string[]) {
    try {
      const res = await fetch(`/api/posts/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pillars, pillar: pillars[0], updated_at: new Date().toISOString() }),
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
      <div className="fixed inset-0 z-[60] bg-black/30" onClick={onClose} />

      <div className="fixed inset-0 sm:inset-auto sm:top-0 sm:right-0 sm:bottom-0 z-[65] w-full sm:w-[480px] bg-bg-primary sm:border-l border-border overflow-y-auto flex flex-col">
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
                <div className="block sm:col-span-3">
                  <span className={labelClass}>Pillars (pick one or more)</span>
                  <div className="flex flex-wrap gap-1.5">
                    {pillarList.map((p) => {
                      const active = form.pillars.includes(p.value);
                      return (
                        <button
                          key={p.value}
                          type="button"
                          onClick={() => togglePillar(p.value)}
                          className={`px-3 py-1.5 rounded-full text-[12px] border transition-colors ${
                            active
                              ? 'border-accent-primary text-accent-primary bg-accent-primary/10'
                              : 'border-border text-text-secondary hover:border-border-hover'
                          }`}
                        >
                          {p.label}
                          {active && form.pillars[0] === p.value ? ' (primary)' : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <label className="block">
                  <span className={labelClass}>Platform</span>
                  <select
                    value={form.platform}
                    onChange={(e) => update('platform', e.target.value)}
                    onBlur={autoSave}
                    className={inputClass}
                  >
                    {PLATFORMS.map((p) => (
                      <option key={p} value={p} className="capitalize">
                        {p.charAt(0).toUpperCase() + p.slice(1)}
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

              <label className="block">
                <span className={labelClass}>Script</span>
                <textarea
                  rows={10}
                  value={form.script}
                  onChange={(e) => update('script', e.target.value)}
                  onBlur={autoSave}
                  className={`${inputClass} resize-none`}
                />
              </label>

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
                sourcePlatform={form.platform as Platform}
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
                <span className="text-[10px] font-medium tracking-widest uppercase text-text-tertiary">
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
                <span className="text-[10px] font-medium tracking-widest uppercase text-text-tertiary">
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

          {activeTab === 'comments' && <EngagementInbox postId={post.id} compact />}

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

      {showPerfModal && (
        <PerformanceModal post={post} onSave={handlePerfSave} onClose={() => setShowPerfModal(false)} />
      )}
    </>
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
