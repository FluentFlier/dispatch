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
import { IcpChat } from '@/components/leads/IcpChat';
import { LeadsHeaderActions, LeadsEmptyState } from '@/components/leads/LeadsFeedChrome';
import type {
  DirectorySettingsRow,
  FollowedCompanyRow,
  SignalLeadWithContacts,
} from '@/lib/signals/types';
import type { UnifiedLeadCard } from '@/lib/signals/feed/normalize';
import type { YcCompanyDetail } from '@/lib/signals/ingest/yc-algolia';
import {
  busyActionFor as deriveBusyAction,
  type LeadBusy,
  type LeadDetailAction,
  type SignalDetailAction,
} from '@/lib/leads/busy';

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

/** Initial feed page + how much each "Load more" adds. Capped by the server at 300. */
const FEED_PAGE_SIZE = 50;
const FEED_MAX = 300;

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
  // Per-action busy tracking: only the clicked button spins, not every button
  // for the lead. `busyActionFor(id)` returns the in-flight action or null.
  const [busy, setBusy] = useState<LeadBusy | null>(null);
  const busyActionFor = useCallback((id: string) => deriveBusyAction(busy, id), [busy]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Leads confirmed as accepted LinkedIn connections (response tracking).
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());
  // Load-more page size: grows the requested feed limit; mergeFeed returns the
  // top-N sorted slice, so raising N appends lower-ranked cards with no dupes.
  const [feedLimit, setFeedLimit] = useState(FEED_PAGE_SIZE);
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
    p.set('limit', String(feedLimit));
    return p.toString();
  }, [filters.status, filters.source, filters.signalType, feedLimit]);

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
    setBusy({ id, action: 'draft' });
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
      setBusy(null);
    }
  };

  const handleApprove = async (
    id: string,
    channel: 'linkedin_connect' | 'linkedin_dm' | 'x_dm' = 'linkedin_connect',
  ) => {
    setBusy({ id, action: 'approve' });
    try {
      const res = await fetch(`/api/leads/${id}/approve`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ channel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'blocked');
      mergeLead(data.lead);
      toast(
        channel === 'x_dm' ? 'X DM sent.' : channel === 'linkedin_dm' ? 'Follow-up DM sent.' : 'LinkedIn invite sent.',
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not approve.', 'error');
    } finally {
      setBusy(null);
    }
  };

  // Response tracking: has the prospect accepted the LinkedIn connection?
  const handleCheckConnection = async (id: string) => {
    setBusy({ id, action: 'check' });
    try {
      const res = await fetch(`/api/leads/${id}/check-connection`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.connected) {
        setAcceptedIds((prev) => new Set(prev).add(id));
        toast('Connection accepted — draft the follow-up DM.', 'success');
      } else {
        toast('Not accepted yet — check back later.');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not check connection.', 'error');
    } finally {
      setBusy(null);
    }
  };

  // Draft the follow-up DM step of the sequence (after a connect is accepted).
  const handleDraftFollowup = async (id: string) => {
    setBusy({ id, action: 'followup' });
    try {
      const res = await fetch(`/api/leads/${id}/draft`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ channel: 'linkedin_dm' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      mergeLead(data.lead);
      setDrafts((d) => ({ ...d, [id]: data.draftText }));
      toast('Follow-up DM drafted — review and approve.');
    } catch {
      toast('Could not draft follow-up.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleEmail = async (id: string) => {
    if (!window.confirm('Send a cold email to this lead? This is a one-time opt-in; an unsubscribe line is added automatically.')) return;
    setBusy({ id, action: 'email' });
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
      setBusy(null);
    }
  };

  const handleDismiss = async (id: string) => {
    setBusy({ id, action: 'dismiss' });
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
      setBusy(null);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  // Bulk dismiss/snooze: only directory leads carry a PATCHable lead row, so we
  // act on the selected ids that resolve to a directory lead and drop them from
  // the list. Runs in parallel; a partial failure still clears what succeeded.
  const bulkLeadAction = async (action: 'dismiss' | 'snooze') => {
    const ids = Array.from(selectedIds).filter((id) => leadsById[id]);
    if (ids.length === 0) {
      toast('Select directory leads to ' + action + '.', 'error');
      return;
    }
    setBulkBusy(true);
    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch(`/api/leads/${id}`, {
            method: 'PATCH',
            headers: jsonHeaders,
            body: JSON.stringify({ action }),
          }).then((r) => {
            if (!r.ok) throw new Error();
            return id;
          }),
        ),
      );
      const done = results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<string>).value);
      const doneSet = new Set(done);
      setCards((prev) => prev.filter((c) => !doneSet.has(c.id)));
      setLeadsById((prev) => {
        const next = { ...prev };
        for (const id of done) delete next[id];
        return next;
      });
      if (selectedId && doneSet.has(selectedId)) setSelectedId(null);
      clearSelection();
      const failed = ids.length - done.length;
      toast(
        `${done.length} ${action === 'dismiss' ? 'dismissed' : 'snoozed'}${failed ? `, ${failed} failed` : ''}.`,
        failed ? 'error' : 'success',
      );
    } finally {
      setBulkBusy(false);
    }
  };

  const handleExport = () => {
    // Attachment Content-Disposition downloads without navigating away. Carry the
    // active status filter so the export matches what the user is looking at.
    const qs = filters.status !== 'all' ? `?status=${encodeURIComponent(filters.status)}` : '';
    const a = document.createElement('a');
    a.href = `/api/leads/export${qs}`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleTogglePlaybookStep = async (
    id: string,
    stepIndex: number,
    status: 'pending' | 'done',
  ) => {
    try {
      const res = await fetch(`/api/leads/${id}/playbook`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ stepIndex, status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      mergeLead(data.lead);
    } catch {
      toast('Could not update step.', 'error');
    }
  };

  const handleSnooze = async (id: string) => {
    setBusy({ id, action: 'snooze' });
    try {
      const res = await fetch(`/api/leads/${id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ action: 'snooze' }) });
      if (!res.ok) throw new Error();
      // Snoozed leads leave today's surface (digest_date pushed +1); drop from view like dismiss.
      setCards((prev) => prev.filter((c) => c.id !== id));
      setLeadsById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (selectedId === id) setSelectedId(null);
      toast('Snoozed until tomorrow.');
    } catch {
      toast('Could not snooze.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleResolve = async (id: string, force = false) => {
    setBusy({ id, action: 'resolve' });
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
      setBusy(null);
    }
  };

  const handlePlanNurture = async (id: string) => {
    setBusy({ id, action: 'plan' });
    try {
      const res = await fetch(`/api/leads/${id}/playbook`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Plan failed');
      mergeLead(data.lead);
      if (data.lead?.outreach?.draft_text) {
        setDrafts((d) => ({ ...d, [id]: data.lead.outreach.draft_text }));
      }
      toast('Nurture plan ready — connect queued.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not plan nurture.', 'error');
    } finally {
      setBusy(null);
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
    setBusy({ id, action: 'draft' });
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
      setBusy(null);
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
    setBusy({ id, action: 'send' });
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
      setBusy(null);
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
            onExport={handleExport}
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
        <div className="space-y-6">
          <IcpChat
            settings={settings}
            onSettingsSaved={setSettings}
            onDiscoveryComplete={() => void loadBootstrap()}
            toast={toast}
          />
          <SignalsSetup />
        </div>
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
          <div className="lg:col-span-2 space-y-2">
            {selectedIds.size > 0 && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-accent-primary/30 bg-accent-primary/5 px-3 py-2">
                <span className="text-xs font-medium text-text-primary">{selectedIds.size} selected</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={bulkBusy}
                    onClick={() => bulkLeadAction('snooze')}
                    className="text-xs px-2 py-1 rounded-md border border-border bg-bg-secondary hover:bg-bg-primary text-text-secondary disabled:opacity-50"
                  >
                    Snooze
                  </button>
                  <button
                    type="button"
                    disabled={bulkBusy}
                    onClick={() => bulkLeadAction('dismiss')}
                    className="text-xs px-2 py-1 rounded-md border border-border bg-bg-secondary hover:bg-bg-primary text-text-secondary disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="text-xs px-2 py-1 rounded-md text-text-tertiary hover:text-text-primary"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
            <UnifiedFeed
              cards={visibleCards}
              selectedId={selectedId}
              loading={false}
              refreshing={listLoading}
              onSelect={setSelectedId}
              isFollowed={isFollowed}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
            />
            {cards.length >= feedLimit && feedLimit < FEED_MAX && (
              <button
                type="button"
                disabled={listLoading}
                onClick={() => setFeedLimit((n) => Math.min(n + FEED_PAGE_SIZE, FEED_MAX))}
                className="w-full text-xs font-medium py-2 rounded-md border border-border bg-bg-secondary hover:bg-bg-primary text-text-secondary disabled:opacity-50"
              >
                {listLoading ? 'Loading…' : 'Load more'}
              </button>
            )}
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
                busyAction={busyActionFor(selectedLead.id) as LeadDetailAction | null}
                followed={isFollowed(selectedCard)}
                onDraft={() => handleDraft(selectedLead.id)}
                onApprove={(channel) => handleApprove(selectedLead.id, channel)}
                onEmail={() => handleEmail(selectedLead.id)}
                onDismiss={() => handleDismiss(selectedLead.id)}
                onSnooze={() => handleSnooze(selectedLead.id)}
                onResolve={(force?: boolean) => handleResolve(selectedLead.id, force ?? false)}
                onFollow={() => handleFollowLead(selectedLead)}
                onPlanNurture={() => handlePlanNurture(selectedLead.id)}
                onToggleStep={(stepIndex, status) =>
                  handleTogglePlaybookStep(selectedLead.id, stepIndex, status)
                }
                onDraftFollowup={() => handleDraftFollowup(selectedLead.id)}
                onCheckConnection={() => handleCheckConnection(selectedLead.id)}
                accepted={acceptedIds.has(selectedLead.id)}
              />
            ) : (
              <SignalDetail
                card={selectedCard}
                draft={drafts[selectedCard.id] ?? ''}
                onDraftChange={(v) => setDrafts((d) => ({ ...d, [selectedCard.id]: v }))}
                busyAction={busyActionFor(selectedCard.id) as SignalDetailAction | null}
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
        onDiscoveryComplete={() => void loadBootstrap()}
        toast={toast}
      />
    </div>
  );
}
