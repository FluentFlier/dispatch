'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Plus, Send, SkipForward, Sparkles } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { parseLinkedInPostTarget } from '@/lib/engagement/post-url';
import type { EngagementTaskRow } from '@/lib/engagement/tasks';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-amber-500/10 text-amber-600',
  approved: 'bg-sage/10 text-sage',
  processing: 'bg-blue-500/10 text-blue-600',
  sent: 'bg-sage/10 text-sage',
  failed: 'bg-coral/10 text-coral',
  skipped: 'bg-bg text-text-tertiary',
};

/**
 * Outbound engagement queue: draft AI comments on other people's posts,
 * review/edit them, and approve for the cron worker to post at human-paced
 * intervals. The counterpart to the inbox (their comments on your posts).
 */
export default function OutboundQueue() {
  const { toast } = useToast();
  const [tasks, setTasks] = useState<EngagementTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [postUrl, setPostUrl] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/engagement/tasks', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      setTasks(data.tasks ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  const createTask = async () => {
    const target = parseLinkedInPostTarget(postUrl);
    if (!target) {
      toast('Paste a LinkedIn post URL or activity ID', 'error');
      return;
    }
    if (!excerpt.trim()) {
      toast('Paste the post text so the AI has context', 'error');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/engagement/tasks', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_provider_post_id: target,
          target_post_url: postUrl.startsWith('http') ? postUrl : undefined,
          target_author_name: authorName.trim() || undefined,
          target_post_excerpt: excerpt.trim(),
          kind: 'comment',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? 'Could not draft comment', 'error');
        return;
      }
      toast('Comment drafted — review and approve below', 'success');
      setPostUrl('');
      setExcerpt('');
      setAuthorName('');
      setShowForm(false);
      await fetchTasks();
    } finally {
      setCreating(false);
    }
  };

  const patchTask = async (id: string, action: 'approve' | 'skip', commentText?: string) => {
    const res = await fetch('/api/engagement/tasks', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action, comment_text: commentText }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error ?? 'Update failed', 'error');
      return;
    }
    toast(action === 'approve' ? 'Approved — will post shortly' : 'Skipped', 'success');
    await fetchTasks();
  };

  const pending = tasks.filter((t) => t.status === 'draft' || t.status === 'approved' || t.status === 'processing' || t.status === 'failed');
  const done = tasks.filter((t) => t.status === 'sent' || t.status === 'skipped').slice(0, 10);

  return (
    <div className="mt-10 rounded-xl border border-border bg-bg-secondary p-6">
      <div className="mb-4 flex items-center gap-2">
        <Send className="h-5 w-5 text-coral" />
        <h3 className="font-semibold">Outbound Engagement</h3>
        <span className="text-xs px-2 py-0.5 rounded bg-coral/10 text-coral">
          Comment on others&apos; posts, in your voice
        </span>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-bg"
        >
          <Plus className="h-4 w-4" /> New target
        </button>
      </div>

      {showForm && (
        <div className="mb-6 space-y-3 rounded-lg border border-border/60 bg-bg p-4">
          <input
            value={postUrl}
            onChange={(e) => setPostUrl(e.target.value)}
            placeholder="LinkedIn post URL (or activity ID)"
            className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm"
          />
          <input
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            placeholder="Post author (optional)"
            className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm"
          />
          <textarea
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            placeholder="Paste the post text — the AI drafts your comment from this"
            rows={3}
            className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void createTask()}
            disabled={creating}
            className="inline-flex items-center gap-2 rounded-lg bg-coral px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Draft comment in my voice
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-sm text-text-tertiary">Loading queue…</div>
      ) : pending.length === 0 && done.length === 0 ? (
        <p className="text-sm text-text-tertiary">
          No outbound comments yet. Add a target post and the AI drafts a comment in your voice;
          approved comments are posted automatically at natural, human-paced times.
        </p>
      ) : (
        <div className="space-y-3">
          {pending.map((task) => (
            <div key={task.id} className="rounded-lg border border-border/60 bg-bg p-4">
              <div className="mb-2 flex items-center gap-2 text-xs text-text-tertiary">
                <span className={`rounded px-2 py-0.5 font-mono uppercase ${STATUS_STYLES[task.status] ?? ''}`}>
                  {task.status}
                </span>
                {task.target_author_name && <span>→ {task.target_author_name}</span>}
                {task.target_post_url && (
                  <a
                    href={task.target_post_url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-text-secondary"
                  >
                    View post
                  </a>
                )}
                {task.last_error && <span className="text-coral">{task.last_error}</span>}
              </div>
              {task.target_post_excerpt && (
                <p className="mb-2 line-clamp-2 text-xs text-text-tertiary">
                  “{task.target_post_excerpt}”
                </p>
              )}
              <textarea
                value={edits[task.id] ?? task.comment_text ?? ''}
                onChange={(e) => setEdits((prev) => ({ ...prev, [task.id]: e.target.value }))}
                rows={2}
                disabled={task.status === 'processing'}
                className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm"
              />
              {(task.status === 'draft' || task.status === 'failed') && (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void patchTask(task.id, 'approve', edits[task.id] ?? undefined)}
                    className="inline-flex items-center gap-1 rounded-lg bg-sage px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
                  >
                    <Check className="h-4 w-4" /> Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => void patchTask(task.id, 'skip')}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-bg"
                  >
                    <SkipForward className="h-4 w-4" /> Skip
                  </button>
                </div>
              )}
            </div>
          ))}

          {done.length > 0 && (
            <details className="pt-2">
              <summary className="cursor-pointer text-xs text-text-tertiary">
                Recent activity ({done.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {done.map((task) => (
                  <li key={task.id} className="flex items-center gap-2 text-xs text-text-tertiary">
                    <span className={`rounded px-1.5 py-0.5 font-mono uppercase ${STATUS_STYLES[task.status] ?? ''}`}>
                      {task.status}
                    </span>
                    <span className="truncate">{task.comment_text ?? task.kind}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
