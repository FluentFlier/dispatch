'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  RefreshCw,
  Sparkles,
  Send,
  X,
  Pin,
  ExternalLink,
  SlidersHorizontal,
  Settings,
  TrendingUp,
  Download,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { useToast } from '@/components/ui/Toast';
import type {
  DirectorySettingsRow,
  FollowedCompanyRow,
  LeadStatus,
  SignalLeadWithContacts,
} from '@/lib/signals/types';

const FILTERS: Array<{ key: LeadStatus | 'all'; label: string }> = [
  { key: 'new', label: 'New' },
  { key: 'drafted', label: 'Drafted' },
  { key: 'approved', label: 'Approved' },
  { key: 'sent', label: 'Sent' },
  { key: 'dismissed', label: 'Dismissed' },
  { key: 'all', label: 'All' },
];

const CONNECT_LIMIT = 300;

export default function LeadsPage() {
  const { toast } = useToast();
  const [leads, setLeads] = useState<SignalLeadWithContacts[]>([]);
  const [settings, setSettings] = useState<DirectorySettingsRow | null>(null);
  const [followed, setFollowed] = useState<FollowedCompanyRow[]>([]);
  const [filter, setFilter] = useState<LeadStatus | 'all'>('new');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const bootstrapped = useRef(false);

  // --- Data loading ---
  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/leads/bootstrap?status=${filter}`);
      if (!res.ok) throw new Error('load failed');
      const data = await res.json();
      setLeads(data.leads ?? []);
      setSettings(data.settings ?? null);
      setFollowed(data.followedCompanies ?? []);
      // Timezone detection: persist the browser tz once if the workspace has none.
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) void fetch('/api/leads/settings', { method: 'PUT', headers: json(), body: JSON.stringify({ timezone: tz }) });
    } catch {
      toast('Could not load leads.', 'error');
    } finally {
      setLoading(false);
    }
  }, [filter, toast]);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void loadBootstrap();
  }, [loadBootstrap]);

  const refetchList = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await fetch(`/api/leads?status=${filter}`);
      const data = await res.json();
      setLeads(data.leads ?? []);
    } catch {
      toast('Could not refresh.', 'error');
    } finally {
      setListLoading(false);
    }
  }, [filter, toast]);

  useEffect(() => {
    if (!bootstrapped.current) return;
    void refetchList();
  }, [filter, refetchList]);

  const mergeLead = (updated: SignalLeadWithContacts) =>
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));

  // --- Actions ---
  const handleScrape = async () => {
    setScraping(true);
    try {
      const res = await fetch('/api/leads/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const r = data.result;
      toast(`Scrape done: ${r.inserted} new, ${r.updated} updated, ${r.resolved} resolved.`);
      await refetchList();
    } catch {
      toast('Scrape failed.', 'error');
    } finally {
      setScraping(false);
    }
  };

  const handleDraft = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/leads/${id}/draft`, { method: 'POST', headers: json(), body: '{}' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      mergeLead(data.lead);
      setDrafts((d) => ({ ...d, [id]: data.draftText }));
      toast('Draft ready.');
    } catch {
      toast('Could not draft.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleApprove = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/leads/${id}/approve`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'blocked');
      mergeLead(data.lead);
      toast('Approved.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not approve.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDismiss = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/leads/${id}`, { method: 'PATCH', headers: json(), body: JSON.stringify({ action: 'dismiss' }) });
      if (!res.ok) throw new Error();
      setLeads((prev) => prev.filter((l) => l.id !== id));
      if (selectedId === id) setSelectedId(null);
      toast('Lead dismissed.');
    } catch {
      toast('Could not dismiss.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleResolve = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/leads/${id}/resolve`, { method: 'POST' });
      const data = await res.json();
      mergeLead(data.lead);
      toast(data.lead?.contact_status === 'resolved' ? 'Contact found.' : 'Still no contact.', data.lead?.contact_status === 'resolved' ? 'success' : 'error');
    } catch {
      toast('Could not resolve.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleFollow = async (lead: SignalLeadWithContacts) => {
    try {
      const res = await fetch('/api/leads/followed', {
        method: 'POST',
        headers: json(),
        body: JSON.stringify({ companyName: lead.company_name, domain: lead.domain, externalId: lead.external_id }),
      });
      const data = await res.json();
      if (data.duplicate) return toast('Already following.', 'error');
      setFollowed(data.followedCompanies ?? followed);
      toast(`Following ${lead.company_name}.`);
    } catch {
      toast('Could not follow.', 'error');
    }
  };

  const isFollowed = (lead: SignalLeadWithContacts) =>
    followed.some((f) => (lead.domain && f.domain === lead.domain) || f.company_name === lead.company_name);

  const selected = leads.find((l) => l.id === selectedId) ?? null;

  // --- Render ---
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        eyebrow="TODAY"
        title="Today's leads"
        subtitle={`${leads.length} ${filter === 'all' ? '' : filter} lead${leads.length === 1 ? '' : 's'} · ${new Date().toLocaleDateString()}`}
        action={
          <div className="flex items-center gap-2">
            <HeaderBtn onClick={handleScrape} disabled={scraping} icon={<Download className={`h-3.5 w-3.5 ${scraping ? 'animate-pulse' : ''}`} />}>
              {scraping ? 'Scraping…' : 'Scrape now'}
            </HeaderBtn>
            <HeaderBtn onClick={refetchList} disabled={listLoading} icon={<RefreshCw className={`h-3.5 w-3.5 ${listLoading ? 'animate-spin' : ''}`} />}>
              Refresh
            </HeaderBtn>
            <HeaderBtn onClick={() => setDrawerOpen(true)} icon={<SlidersHorizontal className="h-3.5 w-3.5" />}>
              Advanced
            </HeaderBtn>
            <Link href="/leads/settings" className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border border-border bg-bg-secondary hover:bg-bg-primary text-text-secondary">
              <Settings className="h-3.5 w-3.5" /> Settings
            </Link>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filter === f.key ? 'bg-accent-primary text-white' : 'bg-bg-secondary text-text-secondary hover:text-text-primary'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[320px] text-text-tertiary text-sm">Loading leads…</div>
      ) : leads.length === 0 ? (
        <EmptyState onScrape={handleScrape} scraping={scraping} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 min-h-[480px]">
          {/* List */}
          <div className={`lg:col-span-2 border border-border rounded-lg bg-bg-secondary overflow-hidden ${listLoading ? 'opacity-60' : ''}`}>
            {leads
              .slice()
              .sort((a, b) => Number(isFollowed(b)) - Number(isFollowed(a)) || b.rank_score - a.rank_score)
              .map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => setSelectedId(lead.id)}
                  className={`w-full text-left px-4 py-3 border-b border-border last:border-0 transition-colors ${
                    selectedId === lead.id ? 'bg-bg-primary border-l-2 border-l-accent-primary' : 'hover:bg-bg-tertiary'
                  } ${isFollowed(lead) ? 'bg-sage-light/40' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono uppercase tracking-wide text-accent-primary">
                      {sourceTag(lead)}
                    </span>
                    <span className="text-xs text-text-tertiary shrink-0 flex items-center gap-1">
                      {isFollowed(lead) && <Pin className="h-3 w-3 text-accent-secondary" />}
                      {lead.rank_score.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-text-primary line-clamp-1 mt-0.5">{lead.company_name}</p>
                  <p className="text-xs text-text-tertiary line-clamp-1">{lead.tagline}</p>
                  <div className="flex gap-1.5 mt-1">{statusChips(lead)}</div>
                </button>
              ))}
          </div>

          {/* Detail */}
          <div className="lg:col-span-3 border border-border rounded-lg bg-bg-secondary p-5">
            {!selected ? (
              <div className="flex items-center justify-center h-full text-text-tertiary text-sm">Select a lead to review.</div>
            ) : (
              <LeadDetail
                lead={selected}
                draft={drafts[selected.id] ?? selected.outreach?.draft_text ?? ''}
                onDraftChange={(v) => setDrafts((d) => ({ ...d, [selected.id]: v }))}
                busy={busyId === selected.id}
                followed={isFollowed(selected)}
                onDraft={() => handleDraft(selected.id)}
                onApprove={() => handleApprove(selected.id)}
                onDismiss={() => handleDismiss(selected.id)}
                onResolve={() => handleResolve(selected.id)}
                onFollow={() => handleFollow(selected)}
              />
            )}
          </div>
        </div>
      )}

      <AdvancedDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        settings={settings}
        followed={followed}
        onSettingsSaved={(s) => setSettings(s)}
        onFollowedChange={setFollowed}
        toast={toast}
      />
    </div>
  );
}

// --- Helpers ---
function json() {
  return { 'Content-Type': 'application/json' };
}
function sourceTag(lead: SignalLeadWithContacts): string {
  const src = lead.source === 'product_hunt' ? 'PH' : 'YC';
  return lead.batch ? `${src} · ${lead.batch}` : src;
}
function statusChips(lead: SignalLeadWithContacts) {
  const chips: Array<{ text: string; cls: string }> = [];
  if (lead.lead_status === 'new') chips.push({ text: 'New', cls: 'bg-coral-light text-accent-primary' });
  if (lead.lead_status === 'resurfaced') chips.push({ text: '↑ Resurfaced', cls: 'bg-sage-light text-accent-secondary' });
  if (lead.contact_status === 'no_contact') chips.push({ text: 'No contact', cls: 'bg-bg-tertiary text-text-tertiary' });
  if ((lead.name_history ?? []).length > 0) chips.push({ text: 'Renamed', cls: 'bg-bg-tertiary text-text-tertiary' });
  return chips.map((c) => (
    <span key={c.text} className={`text-[10px] px-1.5 py-0.5 rounded ${c.cls}`}>
      {c.text}
    </span>
  ));
}

function HeaderBtn({ onClick, disabled, icon, children }: { onClick: () => void; disabled?: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border border-border bg-bg-secondary hover:bg-bg-primary text-text-secondary disabled:opacity-50"
    >
      {icon}
      {children}
    </button>
  );
}

function EmptyState({ onScrape, scraping }: { onScrape: () => void; scraping: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center text-center min-h-[360px] gap-3">
      <div className="p-3 rounded-lg bg-coral-light">
        <TrendingUp className="h-6 w-6 text-accent-primary" />
      </div>
      <h2 className="font-serif text-[20px] text-text-primary">No leads yet today</h2>
      <p className="text-sm text-text-secondary max-w-sm">
        Scrape the directories now, or your next batch lands at your configured digest hour. Tune sources & ICP in Advanced.
      </p>
      <div className="flex gap-2 mt-1">
        <Button variant="primary" size="sm" onClick={onScrape} loading={scraping}>
          Scrape now
        </Button>
        <Link href="/leads/settings">
          <Button variant="secondary" size="sm">Open settings</Button>
        </Link>
      </div>
    </div>
  );
}

function LeadDetail({
  lead,
  draft,
  onDraftChange,
  busy,
  followed,
  onDraft,
  onApprove,
  onDismiss,
  onResolve,
  onFollow,
}: {
  lead: SignalLeadWithContacts;
  draft: string;
  onDraftChange: (v: string) => void;
  busy: boolean;
  followed: boolean;
  onDraft: () => void;
  onApprove: () => void;
  onDismiss: () => void;
  onResolve: () => void;
  onFollow: () => void;
}) {
  const contact = lead.primary_contact;
  const noContact = lead.contact_status === 'no_contact';
  const overLimit = draft.length > CONNECT_LIMIT;
  const fact = lead.source_fact as { batch?: string; tagline?: string };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-mono uppercase tracking-wide text-text-tertiary">{sourceTag(lead)}</p>
          <h2 className="text-xl font-display text-text-primary">{lead.company_name}</h2>
          {(lead.name_history ?? []).length > 0 && (
            <p className="text-xs text-text-tertiary">Renamed · was {lead.name_history[lead.name_history.length - 1]}</p>
          )}
          {lead.website && (
            <a href={lead.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent-primary hover:underline mt-0.5">
              {lead.domain ?? lead.website} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <button onClick={onFollow} className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-border ${followed ? 'text-accent-secondary bg-sage-light' : 'text-text-secondary hover:bg-bg-tertiary'}`}>
          <Pin className="h-3.5 w-3.5" /> {followed ? 'Following' : 'Follow'}
        </button>
      </div>

      {/* Contact block */}
      {noContact ? (
        <div className="bg-bg-tertiary rounded-md p-3 text-sm text-text-secondary flex items-center justify-between gap-3">
          <span>No reachable contact found. This lead can&apos;t be messaged yet.</span>
          <Button variant="ghost" size="sm" onClick={onResolve} loading={busy}>Try to resolve</Button>
        </div>
      ) : contact ? (
        <p className="text-sm text-text-secondary">
          {contact.name}
          {contact.role ? ` · ${contact.role}` : ''}
          {contact.linkedin_url && (
            <a href={contact.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-primary hover:underline ml-2">
              LinkedIn <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </p>
      ) : null}

      {/* Source-fact strip */}
      <blockquote className="text-sm text-text-secondary border-l-2 border-border pl-3 py-1">
        Claim used: {fact.batch ? `joined YC ${fact.batch}` : lead.source}
        {fact.tagline ? ` · "${fact.tagline}"` : ''}
      </blockquote>

      {/* Draft */}
      {draft ? (
        <div className="space-y-1">
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            rows={5}
            className="w-full rounded-md border border-border bg-bg-primary p-3 text-sm text-text-primary focus:outline-none focus:border-border-hover"
          />
          <div className={`text-xs text-right ${overLimit ? 'text-red-600' : 'text-text-tertiary'}`}>
            {draft.length}/{CONNECT_LIMIT}
          </div>
        </div>
      ) : (
        <Button variant="primary" size="sm" onClick={onDraft} loading={busy}>
          <Sparkles className="h-4 w-4" /> Draft message
        </Button>
      )}

      {/* Actions */}
      {draft && (
        <div className="flex items-center gap-2 pt-1">
          <Button variant="primary" size="sm" onClick={onApprove} disabled={noContact || overLimit || busy}>
            <Send className="h-4 w-4" /> Approve
          </Button>
          <Button variant="ghost" size="sm" onClick={onDraft} loading={busy}>
            <RefreshCw className="h-4 w-4" /> Regenerate
          </Button>
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            <X className="h-4 w-4" /> Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}

function AdvancedDrawer({
  open,
  onClose,
  settings,
  followed,
  onSettingsSaved,
  onFollowedChange,
  toast,
}: {
  open: boolean;
  onClose: () => void;
  settings: DirectorySettingsRow | null;
  followed: FollowedCompanyRow[];
  onSettingsSaved: (s: DirectorySettingsRow) => void;
  onFollowedChange: (f: FollowedCompanyRow[]) => void;
  toast: (m: string, t?: 'success' | 'error') => void;
}) {
  const [verticals, setVerticals] = useState('');
  const [keywords, setKeywords] = useState('');
  const [company, setCompany] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setVerticals((settings.icp_verticals ?? []).join(', '));
      setKeywords((settings.icp_keywords ?? []).join(', '));
    }
  }, [settings]);

  const apply = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/leads/settings', {
        method: 'PUT',
        headers: json(),
        body: JSON.stringify({
          icp_verticals: split(verticals),
          icp_keywords: split(keywords),
        }),
      });
      const data = await res.json();
      onSettingsSaved(data.settings);
      toast('Filters applied.');
    } catch {
      toast('Could not save.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const follow = async () => {
    if (!company.trim()) return;
    const res = await fetch('/api/leads/followed', { method: 'POST', headers: json(), body: JSON.stringify({ companyName: company.trim() }) });
    const data = await res.json();
    if (data.duplicate) return toast('Already following.', 'error');
    onFollowedChange(data.followedCompanies ?? followed);
    setCompany('');
    toast(`Following ${company.trim()}.`);
  };

  const unfollow = async (id: string) => {
    const res = await fetch(`/api/leads/followed/${id}`, { method: 'DELETE' });
    const data = await res.json();
    onFollowedChange(data.followedCompanies ?? followed);
    toast('Unfollowed.');
  };

  return (
    <Drawer open={open} onClose={onClose}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-display text-text-primary">Advanced</h2>
        <button onClick={onClose} className="p-1 text-text-tertiary hover:text-text-primary"><X className="h-5 w-5" /></button>
      </div>

      <section className="space-y-3 mb-6">
        <p className="text-xs font-mono uppercase tracking-wide text-text-tertiary">Filters</p>
        <label className="block text-sm text-text-secondary">
          ICP verticals
          <input value={verticals} onChange={(e) => setVerticals(e.target.value)} placeholder="Fintech, AI, SaaS" className="mt-1 w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm text-text-secondary">
          ICP keywords
          <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="compliance, analytics" className="mt-1 w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm" />
        </label>
        <p className="text-xs text-text-tertiary">Leads matching these rank higher. Leave blank to see everything.</p>
        <Button variant="primary" size="sm" onClick={apply} loading={saving}>Apply</Button>
      </section>

      <section className="space-y-3">
        <p className="text-xs font-mono uppercase tracking-wide text-text-tertiary">Follow companies</p>
        <div className="flex gap-2">
          <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company name or domain" className="flex-1 rounded-md border border-border bg-bg-primary px-3 py-2 text-sm" />
          <Button variant="primary" size="sm" onClick={follow}>Follow</Button>
        </div>
        {followed.length === 0 ? (
          <p className="text-xs text-text-tertiary">Follow specific companies to always track them for funding/hiring signals.</p>
        ) : (
          <ul className="space-y-1">
            {followed.map((f) => (
              <li key={f.id} className="flex items-center justify-between text-sm text-text-secondary border border-border rounded-md px-3 py-1.5">
                <span>{f.company_name}{f.domain ? ` · ${f.domain}` : ''}</span>
                <button onClick={() => unfollow(f.id)} className="text-text-tertiary hover:text-red-600"><X className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-text-tertiary">Followed companies resurface automatically when something changes.</p>
      </section>
    </Drawer>
  );
}

function split(v: string): string[] {
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}
