'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/PageHeader';
import { useToast } from '@/components/ui/Toast';
import { FeedFilters, type FeedFilterState } from '@/components/leads/FeedFilters';
import { UnifiedFeed } from '@/components/leads/UnifiedFeed';
import { LeadDetail } from '@/components/leads/LeadDetail';
import { SignalDetail } from '@/components/leads/SignalDetail';
import { resolveSignalOutreach } from '@/components/leads/signal-outreach';
import { AdvancedDrawer } from '@/components/leads/AdvancedDrawer';
import { SignalsSetup } from '@/components/leads/SignalsSetup';
import { LeadsHeaderActions, LeadsEmptyState } from '@/components/leads/LeadsFeedChrome';
import type {
  DirectorySettingsRow,
  FollowedCompanyRow,
  SignalLeadWithContacts,
} from '@/lib/signals/types';
import type { UnifiedLeadCard } from '@/lib/signals/feed/normalize';
import type { YcCompanyDetail } from '@/lib/signals/ingest/yc-algolia';

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

/** Empty client-side extras applied on top of the server-filtered feed. */
const INITIAL_FILTERS: FeedFilterState = {
  status: 'new',
  source: 'all',
  signalType: 'all',
  vertical: 'all',
  search: '',
  sort: 'score',
};

/**
 * Unified leads feed page. One inbox that renders both live signal events and
 * directory companies (from `/api/leads/feed`) in a single list, and reuses the
 * existing directory detail/draft/approve panel (`LeadDetail`) when a directory
 * card is opened. Directory leads are also loaded (via `/api/leads/bootstrap`)
 * because the detail panel and its actions need the full `SignalLeadWithContacts`
 * record; signal cards open a lighter read-only `SignalDetail`.
 */
export default function LeadsPage() {
  const { toast } = useToast();
  const searchParams = useSearchParams();

  // Feed = the unified list (both kinds). Directory-lead map = detail source.
  const [cards, setCards] = useState<UnifiedLeadCard[]>([]);
  const [leadsById, setLeadsById] = useState<Record<string, SignalLeadWithContacts>>({});
  const [settings, setSettings] = useState<DirectorySettingsRow | null>(null);
  const [followed, setFollowed] = useState<FollowedCompanyRow[]>([]);

  const [filters, setFilters] = useState<FeedFilterState>(INITIAL_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Inline safety-guard notice per signal (expected 422 block: dry-run/cap/hours).
  const [signalNotices, setSignalNotices] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Header toggle: "feed" is the unified lead list (default); "setup" is the
  // signal + directory configuration surface folded in from the retired /signals page.
  const [view, setView] = useState<'feed' | 'setup'>('feed');
  const [companyById, setCompanyById] = useState<Record<string, YcCompanyDetail | 'loading'>>({});
  const [draftAll, setDraftAll] = useState<{ done: number; total: number } | null>(null);
  const bootstrapped = useRef(false);

  useEffect(() => {
    if (searchParams.get('view') === 'setup') {
      setView('setup');
    }
  }, [searchParams]);

  // --- Data loading ---
  // Directory-lead detail + settings + watchlist come from bootstrap; the feed
  // list comes from /api/leads/feed. The two are kept in sync by status filter.
  const feedQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (filters.status !== 'all') p.set('status', filters.status);
    if (filters.source !== 'all') p.set('source', filters.source);
    if (filters.signalType !== 'all') p.set('signalType', filters.signalType);
    return p.toString();
  }, [filters.status, filters.source, filters.signalType]);

  const indexLeads = (leads: SignalLeadWithContacts[]) =>
    setLeadsById((prev) => {
      const next = { ...prev };
      for (const l of leads) next[l.id] = l;
      return next;
    });

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const [feedRes, bootRes] = await Promise.all([
        fetch(`/api/leads/feed?${feedQuery()}`),
        fetch(`/api/leads/bootstrap?status=${filters.status}`),
      ]);
      if (!feedRes.ok || !bootRes.ok) throw new Error('load failed');
      const feed = await feedRes.json();
      const boot = await bootRes.json();
      setCards(feed.cards ?? []);
      indexLeads(boot.leads ?? []);
      setSettings(boot.settings ?? null);
      setFollowed(boot.followedCompanies ?? []);
      // Persist the browser timezone once if the workspace has none.
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) void fetch('/api/leads/settings', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ timezone: tz }) });
    } catch {
      toast('Could not load leads.', 'error');
    } finally {
      setLoading(false);
    }
  }, [feedQuery, filters.status, toast]);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void loadBootstrap();
  }, [loadBootstrap]);

  // Refetch the feed list (and keep the directory-lead map fresh) when the
  // server-side filters change, without reloading settings/watchlist.
  const refetchList = useCallback(async () => {
    setListLoading(true);
    try {
      const [feedRes, leadsRes] = await Promise.all([
        fetch(`/api/leads/feed?${feedQuery()}`),
        fetch(`/api/leads?status=${filters.status}`),
      ]);
      const feed = await feedRes.json();
      const leadsData = await leadsRes.json();
      setCards(feed.cards ?? []);
      indexLeads(leadsData.leads ?? []);
    } catch {
      toast('Could not refresh.', 'error');
    } finally {
      setListLoading(false);
    }
  }, [feedQuery, filters.status, toast]);

  useEffect(() => {
    if (!bootstrapped.current) return;
    void refetchList();
  }, [filters.status, filters.source, filters.signalType, refetchList]);

  // Merge an updated directory lead back into the map and reflect its new status
  // on the matching feed card so the list stays consistent without a refetch.
  const mergeLead = useCallback((updated: SignalLeadWithContacts) => {
    setLeadsById((prev) => ({ ...prev, [updated.id]: updated }));
    setCards((prev) =>
      prev.map((c) =>
        c.id === updated.id ? { ...c, status: updated.lead_status, contactStatus: updated.contact_status, score: updated.rank_score ?? c.score } : c,
      ),
    );
  }, []);

  // Reflect a signal event's new status on its feed card so a sent signal
  // leaves the "New" filter, mirroring how mergeLead reflects directory-lead
  // status changes back to the list.
  const mergeSignalStatus = useCallback((id: string, status: string) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
  }, []);

  // Fetch rich company info the first time a directory lead is opened.
  useEffect(() => {
    if (!selectedId || companyById[selectedId]) return;
    const card = cards.find((c) => c.id === selectedId);
    if (!card || card.kind !== 'directory') return;
    const id = selectedId;
    setCompanyById((m) => ({ ...m, [id]: 'loading' }));
    fetch(`/api/leads/${id}/company`)
      .then((r) => r.json())
      .then((d) => setCompanyById((m) => ({ ...m, [id]: (d.company as YcCompanyDetail) ?? null })))
      .catch(() =>
        setCompanyById((m) => {
          const next = { ...m };
          delete next[id];
          return next;
        }),
      );
  }, [selectedId, companyById, cards]);

  // --- Followed helpers ---
  const isFollowed = useCallback(
    (card: UnifiedLeadCard) => {
      const lead = leadsById[card.id];
      const domain = lead?.domain ?? null;
      return followed.some((f) => (domain && f.domain === domain) || f.company_name === card.companyName);
    },
    [followed, leadsById],
  );

  // --- Client-side view: pin followed, apply vertical/search, re-sort ---
  const visibleCards = useMemo(() => {
    const term = filters.search.trim().toLowerCase();
    const vertical = filters.vertical === 'all' ? null : filters.vertical.toLowerCase();
    const filtered = cards.filter((c) => {
      if (term) {
        const hay = `${c.companyName ?? ''} ${c.tagline ?? ''} ${c.signalSummary ?? ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (vertical) {
        const lead = leadsById[c.id];
        const tags = (lead?.tags ?? []).map((t) => t.toLowerCase());
        const hay = `${c.companyName ?? ''} ${c.tagline ?? ''} ${c.signalSummary ?? ''}`.toLowerCase();
        if (!tags.some((t) => t.includes(vertical)) && !hay.includes(vertical)) return false;
      }
      return true;
    });
    const sorted = filtered.slice().sort((a, b) => {
      if (filters.sort === 'recency') return Date.parse(b.detectedAt) - Date.parse(a.detectedAt);
      return b.score - a.score;
    });
    // Followed companies pinned on top (stable within each group).
    return sorted.sort((a, b) => Number(isFollowed(b)) - Number(isFollowed(a)));
  }, [cards, filters.search, filters.vertical, filters.sort, isFollowed, leadsById]);

  // --- Actions (directory leads) ---
  const handleDraftAll = async () => {
    const targets = Object.values(leadsById).filter(
      (l) => l.contact_status === 'resolved' && !(l.outreach?.draft_text || drafts[l.id]),
    );
    if (targets.length === 0) {
      toast('All resolved leads already have drafts.');
      return;
    }
    setDraftAll({ done: 0, total: targets.length });
    let done = 0;
    const queue = [...targets];
    const worker = async () => {
      for (let lead = queue.shift(); lead; lead = queue.shift()) {
        try {
          const res = await fetch(`/api/leads/${lead.id}/draft`, { method: 'POST', headers: jsonHeaders, body: '{}' });
          const data = await res.json();
          if (res.ok) {
            mergeLead(data.lead);
            setDrafts((d) => ({ ...d, [lead.id]: data.draftText }));
          }
        } catch {
          // Skip a failed lead; keep drafting the rest.
        }
        done += 1;
        setDraftAll({ done, total: targets.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, targets.length) }, worker));
    setDraftAll(null);
    toast(`Drafted ${done} message${done === 1 ? '' : 's'}.`);
  };

  const handleScrape = async () => {
    setScraping(true);
    try {
      const res = await fetch('/api/leads/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const r = data.result;
      const warnings: string[] = r.warnings ?? [];
      if (r.inserted === 0 && warnings.length > 0) {
        toast(`0 new leads — ${warnings[0]}`, 'error');
      } else if (warnings.length > 0) {
        toast(`${r.inserted} new, but ${warnings.length} source(s) failed: ${warnings[0]}`, 'error');
      } else {
        toast(`Scrape done: ${r.inserted} new, ${r.updated} updated, ${r.resolved} resolved.`);
      }
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
      const res = await fetch(`/api/leads/${id}/draft`, { method: 'POST', headers: jsonHeaders, body: '{}' });
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

  const handleEmail = async (id: string) => {
    if (!window.confirm('Send a cold email to this lead? This is a one-time opt-in; an unsubscribe line is added automatically.')) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/leads/${id}/approve`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ channel: 'gmail', emailOptIn: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'blocked');
      mergeLead(data.lead);
      toast('Email sent.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not email.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDismiss = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/leads/${id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ action: 'dismiss' }) });
      if (!res.ok) throw new Error();
      setCards((prev) => prev.filter((c) => c.id !== id));
      setLeadsById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (selectedId === id) setSelectedId(null);
      toast('Lead dismissed.');
    } catch {
      toast('Could not dismiss.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleResolve = async (id: string, force = false) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/leads/${id}/resolve`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      mergeLead(data.lead);
      if (data.lead?.contact_status !== 'resolved') {
        toast(force ? 'Rescan found no contact.' : 'Still no contact found.', 'error');
        return;
      }
      const hasDraft = !force && Boolean(data.lead?.outreach?.draft_text || drafts[id]);
      if (hasDraft) {
        toast('Contact found.', 'success');
        return;
      }
      toast('Contact found — drafting…', 'success');
      const dres = await fetch(`/api/leads/${id}/draft`, { method: 'POST', headers: jsonHeaders, body: '{}' });
      const ddata = await dres.json();
      if (dres.ok) {
        mergeLead(ddata.lead);
        setDrafts((d) => ({ ...d, [id]: ddata.draftText }));
        toast('Draft ready.');
      }
    } catch {
      toast('Could not resolve.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleFollowLead = async (lead: SignalLeadWithContacts) => {
    try {
      const res = await fetch('/api/leads/followed', {
        method: 'POST',
        headers: jsonHeaders,
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

  // --- Actions (signal cards) ---
  // Generate (or regenerate) an AI outreach draft for a signal event. The
  // channel is chosen from the card's reachable contact so the draft is tuned
  // for the surface it will actually be sent on.
  const handleSignalDraft = async (card: UnifiedLeadCard) => {
    const id = card.id;
    setBusyId(id);
    setSignalNotices((n) => {
      const next = { ...n };
      delete next[id];
      return next;
    });
    try {
      const plan = resolveSignalOutreach(card);
      const res = await fetch(`/api/signals/${id}/draft`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ channel: plan.channel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'draft failed');
      setDrafts((d) => ({ ...d, [id]: data.draft?.draftText ?? '' }));
      mergeSignalStatus(id, 'drafted');
      toast('Draft ready.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not draft.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  // Approve + send a signal draft. An HTTP 422 is the safety guard blocking the
  // send (dry-run / cap / working hours) — expected, not a crash — so its reason
  // is surfaced as an inline notice rather than an error toast.
  const handleSignalSend = async (card: UnifiedLeadCard) => {
    const id = card.id;
    const plan = resolveSignalOutreach(card);
    if (!plan.sendable) {
      toast('No messaging channel on this signal. Copy the draft to send by hand.', 'error');
      return;
    }
    setBusyId(id);
    setSignalNotices((n) => {
      const next = { ...n };
      delete next[id];
      return next;
    });
    try {
      const res = await fetch(`/api/signals/${id}/send`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          channel: plan.channel,
          linkedin_identifier: plan.linkedinIdentifier,
          recipient_email: plan.recipientEmail,
          message_text: drafts[id] ?? '',
        }),
      });
      const data = await res.json();
      if (res.status === 422) {
        // Safety guard blocked the send: show the reason inline, leave the draft.
        setSignalNotices((n) => ({ ...n, [id]: data.error || 'Sending is blocked by your safety settings right now.' }));
        return;
      }
      if (!res.ok) throw new Error(data.error || 'send failed');
      mergeSignalStatus(id, 'sent');
      toast('Sent.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not send.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  // --- Selection resolution ---
  const selectedCard = cards.find((c) => c.id === selectedId) ?? null;
  const selectedLead = selectedId ? leadsById[selectedId] ?? null : null;

  // --- Render ---
  const verticals = settings?.icp_verticals ?? [];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        eyebrow="TODAY"
        title="Leads"
        subtitle={
          view === 'feed'
            ? `${visibleCards.length} lead${visibleCards.length === 1 ? '' : 's'} · ${new Date().toLocaleDateString()}`
            : 'Configure who to watch, trigger rules, sending safety, and integrations.'
        }
        action={
          <LeadsHeaderActions
            view={view}
            scraping={scraping}
            listLoading={listLoading}
            draftAll={draftAll}
            onScrape={handleScrape}
            onDraftAll={handleDraftAll}
            onRefresh={refetchList}
            onOpenDrawer={() => setDrawerOpen(true)}
          />
        }
      />

      {/* Feed | Setup segmented control */}
      <div className="inline-flex rounded-md border border-border bg-bg-secondary p-1 gap-1">
        {(['feed', 'setup'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors min-h-[36px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary ${
              view === v ? 'bg-accent-primary text-white' : 'text-text-secondary hover:text-text-primary'
            }`}
            aria-pressed={view === v}
          >
            {v === 'feed' ? 'Feed' : 'Setup'}
          </button>
        ))}
      </div>

      {view === 'setup' ? (
        <SignalsSetup />
      ) : (
      <>
      <FeedFilters state={filters} onChange={setFilters} verticals={verticals} />

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 min-h-[480px]">
          <div className="lg:col-span-2">
            <UnifiedFeed cards={[]} selectedId={null} loading onSelect={() => {}} isFollowed={() => false} />
          </div>
          <div className="lg:col-span-3 border border-border rounded-lg bg-bg-secondary p-5 hidden lg:flex items-center justify-center text-text-tertiary text-sm">
            Loading leads…
          </div>
        </div>
      ) : cards.length === 0 ? (
        <LeadsEmptyState onScrape={handleScrape} scraping={scraping} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 min-h-[480px]">
          {/* List */}
          <div className="lg:col-span-2">
            <UnifiedFeed
              cards={visibleCards}
              selectedId={selectedId}
              loading={false}
              refreshing={listLoading}
              onSelect={setSelectedId}
              isFollowed={isFollowed}
            />
          </div>

          {/* Detail */}
          <div className="lg:col-span-3 border border-border rounded-lg bg-bg-secondary p-5">
            {!selectedCard ? (
              <div className="flex items-center justify-center h-full text-text-tertiary text-sm">Select a lead to review.</div>
            ) : selectedCard.kind === 'directory' && selectedLead ? (
              <LeadDetail
                lead={selectedLead}
                company={companyById[selectedLead.id]}
                draft={drafts[selectedLead.id] ?? selectedLead.outreach?.draft_text ?? ''}
                onDraftChange={(v) => setDrafts((d) => ({ ...d, [selectedLead.id]: v }))}
                busy={busyId === selectedLead.id}
                followed={isFollowed(selectedCard)}
                onDraft={() => handleDraft(selectedLead.id)}
                onApprove={() => handleApprove(selectedLead.id)}
                onEmail={() => handleEmail(selectedLead.id)}
                onDismiss={() => handleDismiss(selectedLead.id)}
                onResolve={(force?: boolean) => handleResolve(selectedLead.id, force ?? false)}
                onFollow={() => handleFollowLead(selectedLead)}
              />
            ) : (
              <SignalDetail
                card={selectedCard}
                draft={drafts[selectedCard.id] ?? ''}
                onDraftChange={(v) => setDrafts((d) => ({ ...d, [selectedCard.id]: v }))}
                busy={busyId === selectedCard.id}
                notice={signalNotices[selectedCard.id] ?? null}
                onDraft={() => handleSignalDraft(selectedCard)}
                onSend={() => handleSignalSend(selectedCard)}
              />
            )}
          </div>
        </div>
      )}
      </>
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
