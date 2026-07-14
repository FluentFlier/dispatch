'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Copy,
  RefreshCw,
  Send,
  Shield,
  Sparkles,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { SkeletonLines } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import type { WarmContactCategory, WarmContactRow } from '@/lib/social-graph/types';

const CATEGORY_ORDER: WarmContactCategory[] = ['ICP', 'Potential Lead', 'Community', 'Other'];

type FilterTab = 'all' | 'icp' | 'new';

interface WarmContactsResult {
  contacts: WarmContactRow[];
  buckets: Record<WarmContactCategory, WarmContactRow[]>;
  summary: { total: number; new: number; icp: number };
  meta: { cache_ttl_seconds: number; last_sync_hint: string };
}

interface SafetySnapshot {
  settings: { outreach_enabled: boolean; dry_run: boolean };
  within_working_hours: boolean;
}

function ContactRow({
  contact,
  draftingId,
  sendingId,
  savingId,
  onDraft,
  onSend,
  onDismiss,
  onSaveDraft,
}: {
  contact: WarmContactRow;
  draftingId: string | null;
  sendingId: string | null;
  savingId: string | null;
  onDraft: (id: string) => void;
  onSend: (id: string, note?: string) => void;
  onDismiss: (id: string) => void;
  onSaveDraft: (id: string, draft: string) => void;
}) {
  const { toast } = useToast();
  const [editDraft, setEditDraft] = useState(contact.outreach_draft ?? '');
  const isDrafted = contact.status === 'drafted' || Boolean(contact.outreach_draft);
  const isSent = contact.status === 'sent';

  useEffect(() => {
    setEditDraft(contact.outreach_draft ?? '');
  }, [contact.outreach_draft]);

  const copyDraft = async () => {
    if (!editDraft) return;
    await navigator.clipboard.writeText(editDraft);
    toast('Copied to clipboard');
  };

  return (
    <li className="p-4 flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-text-primary truncate">
              {contact.display_name ?? contact.public_identifier ?? 'Unknown'}
            </p>
            <span className="text-[10px] tracking-wide text-text-muted border border-border rounded px-1.5 py-0.5">
              {contact.status}
            </span>
          </div>
          {contact.headline && (
            <p className="text-xs text-text-secondary line-clamp-2 mt-0.5">{contact.headline}</p>
          )}
          <p className="text-xs text-text-muted mt-1">
            Reacted on {contact.source_post_title ?? 'your post'} · {contact.reaction_type}
          </p>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap">
          {contact.profile_url && (
            <a
              href={contact.profile_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent-primary hover:underline self-center"
            >
              Profile
            </a>
          )}
          {!isSent && contact.status !== 'dismissed' && (
            <Button size="sm" variant="ghost" onClick={() => onDismiss(contact.id)}>
              <X className="w-3 h-3 mr-1" />
              Dismiss
            </Button>
          )}
          {!isDrafted && !isSent && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onDraft(contact.id)}
              disabled={draftingId === contact.id}
            >
              <Sparkles className="w-3 h-3 mr-1" />
              Draft connect
            </Button>
          )}
        </div>
      </div>

      {isDrafted && !isSent && (
        <div className="space-y-2">
          <textarea
            className="w-full text-sm rounded-lg border border-border bg-bg-primary p-3 min-h-[88px] resize-y"
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            maxLength={300}
            placeholder="Connection note (max 300 chars)"
          />
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onSaveDraft(contact.id, editDraft)}
              disabled={savingId === contact.id || !editDraft.trim()}
            >
              Save draft
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void copyDraft()}>
              <Copy className="w-3 h-3 mr-1" />
              Copy
            </Button>
            <Button
              size="sm"
              onClick={() => onSend(contact.id, editDraft)}
              disabled={sendingId === contact.id || !editDraft.trim()}
            >
              <Send className="w-3 h-3 mr-1" />
              Send connect
            </Button>
          </div>
        </div>
      )}

      {isSent && contact.outreach_draft && (
        <p className="text-sm text-text-secondary bg-bg-primary rounded p-2 border border-border">
          Sent: {contact.outreach_draft}
        </p>
      )}
    </li>
  );
}

export default function WarmContactsPanel() {
  const { toast } = useToast();
  const [data, setData] = useState<WarmContactsResult | null>(null);
  const [safety, setSafety] = useState<SafetySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [bulkDrafting, setBulkDrafting] = useState(false);
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [contactsRes, safetyRes] = await Promise.all([
        fetch('/api/social-graph/warm-contacts'),
        fetch('/api/signals/safety'),
      ]);
      if (!contactsRes.ok) {
        const errBody = await contactsRes.json();
        throw new Error(errBody.error ?? 'Failed to load');
      }
      setData((await contactsRes.json()) as WarmContactsResult);
      if (safetyRes.ok) {
        setSafety((await safetyRes.json()) as SafetySnapshot);
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not load warm contacts');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/social-graph/sync', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Sync failed');
      toast(
        `Synced ${body.contactsUpserted ?? 0} contacts from ${body.postsScanned ?? 0} posts`,
      );
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const draftConnect = async (id: string) => {
    setDraftingId(id);
    try {
      const res = await fetch(`/api/social-graph/warm-contacts/${id}/draft`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Draft failed');
      toast('Connection note drafted');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Draft failed');
    } finally {
      setDraftingId(null);
    }
  };

  const bulkDraftIcp = async () => {
    setBulkDrafting(true);
    try {
      const res = await fetch('/api/social-graph/warm-contacts/draft-icp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 5 }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Bulk draft failed');
      toast(`Drafted ${body.drafted ?? 0} ICP connection notes`);
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Bulk draft failed');
    } finally {
      setBulkDrafting(false);
    }
  };

  const saveDraft = async (id: string, draft: string) => {
    setSavingId(id);
    try {
      const res = await fetch(`/api/social-graph/warm-contacts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Save failed');
      toast('Draft saved');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingId(null);
    }
  };

  const sendConnect = async (id: string, note?: string) => {
    setSendingId(id);
    try {
      const res = await fetch(`/api/social-graph/warm-contacts/${id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note ? { note } : {}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Send failed');
      toast('Connection invite sent');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSendingId(null);
    }
  };

  const dismiss = async (id: string) => {
    try {
      const res = await fetch(`/api/social-graph/warm-contacts/${id}/dismiss`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Dismiss failed');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Dismiss failed');
    }
  };

  const filteredContacts = useMemo(() => {
    if (!data?.contacts) return [];
    if (filter === 'icp') return data.contacts.filter((c) => c.category === 'ICP');
    if (filter === 'new') return data.contacts.filter((c) => c.status === 'new');
    return data.contacts;
  }, [data?.contacts, filter]);

  const filteredBuckets = useMemo(() => {
    const buckets: Record<WarmContactCategory, WarmContactRow[]> = {
      ICP: [],
      Community: [],
      'Potential Lead': [],
      Other: [],
    };
    for (const c of filteredContacts) {
      const key = (c.category as WarmContactCategory) in buckets ? c.category : 'Other';
      buckets[key as WarmContactCategory].push(c);
    }
    return buckets;
  }, [filteredContacts]);

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonLines count={4} />
      </div>
    );
  }

  const summary = data?.summary;
  const outreachBlocked =
    safety && (!safety.settings.outreach_enabled || safety.settings.dry_run);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[22px] text-ink tracking-[-0.025em]">Warm contacts</h2>
          <p className="text-sm text-text-secondary mt-1 max-w-xl">
            People who reacted to your posts. Sync reactions, triage ICPs, draft and send connection
            notes in your voice - with Signals safety caps.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="secondary" onClick={() => void bulkDraftIcp()} disabled={bulkDrafting}>
            <Sparkles className={`w-4 h-4 mr-2 ${bulkDrafting ? 'animate-pulse' : ''}`} />
            Draft top ICP
          </Button>
          <Button variant="secondary" onClick={() => void sync()} disabled={syncing}>
            <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
            Sync reactions
          </Button>
        </div>
      </div>

      {outreachBlocked && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-text-secondary">
          <Shield className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
          <p>
            Outreach is{' '}
            {safety?.settings.dry_run ? 'in dry-run mode' : 'disabled'} - drafts work, but sends
            are blocked until you enable outreach in{' '}
            <Link href="/leads?view=setup" className="text-accent-primary hover:underline">
              Leads → Setup
            </Link>
            .
          </p>
        </div>
      )}

      {summary && (
        <div className="flex flex-wrap gap-4 text-sm items-center">
          <span className="flex items-center gap-1.5 text-text-secondary">
            <Users className="w-4 h-4" />
            {summary.total} total
          </span>
          <span className="text-accent-primary font-medium">{summary.icp} ICP</span>
          <span className="text-text-secondary">{summary.new} new</span>
          <div className="flex gap-1 ml-auto">
            {(['all', 'icp', 'new'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={`text-xs px-2.5 py-1 rounded-full border ${
                  filter === tab
                    ? 'border-accent-primary text-accent-primary bg-accent-primary/5'
                    : 'border-border text-text-muted hover:text-text-secondary'
                }`}
              >
                {tab === 'all' ? 'All' : tab === 'icp' ? 'ICP' : 'New'}
              </button>
            ))}
          </div>
        </div>
      )}

      {!filteredContacts.length ? (
        <div className="rounded-lg border border-border bg-bg-secondary p-8 text-center">
          <UserPlus className="w-8 h-8 mx-auto text-text-muted mb-3" />
          <p className="text-sm text-text-secondary">
            Publish posts, then sync to see who engaged. Connect LinkedIn in Settings first.
          </p>
        </div>
      ) : (
        CATEGORY_ORDER.map((cat) => {
          const items = filteredBuckets[cat] ?? [];
          if (items.length === 0) return null;
          return (
            <section key={cat}>
              <h3 className="text-xs font-medium tracking-wide text-text-muted mb-2">
                {cat} ({items.length})
              </h3>
              <ul className="divide-y divide-border rounded-lg border border-border bg-bg-secondary">
                {items.map((c) => (
                  <ContactRow
                    key={c.id}
                    contact={c}
                    draftingId={draftingId}
                    sendingId={sendingId}
                    savingId={savingId}
                    onDraft={(id) => void draftConnect(id)}
                    onSend={(id, note) => void sendConnect(id, note)}
                    onDismiss={(id) => void dismiss(id)}
                    onSaveDraft={(id, draft) => void saveDraft(id, draft)}
                  />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
