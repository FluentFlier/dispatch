'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { isGuardBlock } from '@/components/leads/signal-outreach';
import type { FeedFilterState } from '@/components/leads/FeedFilters';
import type {
  DirectorySettingsRow,
  FollowedCompanyRow,
  IcpProfileRow,
  SignalLeadWithContacts,
} from '@/lib/signals/types';
import type { UnifiedLeadCard } from '@/lib/signals/feed/normalize';
import type { WarmContactRow } from '@/lib/social-graph/types';
import type { YcCompanyDetail } from '@/lib/signals/ingest/yc-algolia';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { busyActionFor as deriveBusyAction, type LeadBusy } from '@/lib/leads/busy';
import { draftAllOutcome } from '@/lib/leads/feed-view';
import { buildApproveBody, parseDuplicateResponse, type DuplicateWarningState } from '@/lib/leads/duplicate-warning';

/** v1 lead channels approve() can send on. Mirrors LeadChannel in send-lead.ts. */
type ApproveChannel = 'linkedin_connect' | 'linkedin_dm' | 'x_dm' | 'gmail';

/** Duplicate-warning state plus the retry parameters needed for "Send anyway". */
type LeadDuplicateWarning = DuplicateWarningState & { attemptChannel: ApproveChannel; emailOptIn?: boolean };

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

/** Fields the scrape toast reads off the streamed DirectorySyncResult. */
type ScrapeResultSummary = {
  inserted: number;
  updated: number;
  resolved: number;
  warnings?: string[];
  perSource?: Array<{ source: string; count: number; error?: string }>;
};

/** Initial feed page + how much each "Load more" adds. Capped by the server at 300. */
const FEED_PAGE_SIZE = 50;

/** Empty client-side extras applied on top of the server-filtered feed. */
const INITIAL_FILTERS: FeedFilterState = {
  status: 'new',
  source: 'all',
  signalType: 'all',
  vertical: 'all',
  search: '',
  sort: 'score',
};


export function useLeadsController() {
  const { toast } = useToast();
  const searchParams = useSearchParams();

  // Feed = the unified list (both kinds). Directory-lead map = detail source.
  const [cards, setCards] = useState<UnifiedLeadCard[]>([]);
  const [leadsById, setLeadsById] = useState<Record<string, SignalLeadWithContacts>>({});
  const [settings, setSettings] = useState<DirectorySettingsRow | null>(null);
  const [profiles, setProfiles] = useState<IcpProfileRow[]>([]);
  const [followed, setFollowed] = useState<FollowedCompanyRow[]>([]);

  const [filters, setFilters] = useState<FeedFilterState>(INITIAL_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Inline safety-guard notice per signal (expected 422 block: dry-run/cap/hours).
  const [signalNotices, setSignalNotices] = useState<Record<string, string>>({});
  // Inline duplicate-contact warning per lead, from a 409 on approve (Task 11).
  const [duplicateWarning, setDuplicateWarning] = useState<Record<string, LeadDuplicateWarning>>({});
  // Debounced server autosave of edited draft text, so edits survive
  // navigation/logout/tab close instead of living only in this state map.
  const draftSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const autosaveDraft = useCallback((id: string, text: string) => {
    setDrafts((d) => ({ ...d, [id]: text }));
    const timers = draftSaveTimers.current;
    if (timers[id]) clearTimeout(timers[id]);
    timers[id] = setTimeout(() => {
      delete timers[id];
      void fetchWithAuth(`/api/leads/${id}/draft`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ draftText: text }),
      }).catch(() => {});
    }, 800);
  }, []);

  const [loading, setLoading] = useState(true);
  // True when the initial bootstrap fetch FAILED (vs a genuine empty feed), so
  // the UI shows a retry instead of the misleading "No leads yet" empty state.
  const [loadError, setLoadError] = useState(false);
  // Soft setup gate when signals tables / signals_engine flag are unavailable.
  const [setupRequired, setSetupRequired] = useState(false);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [scraping, setScraping] = useState(false);
  // Live scrape progress streamed from /api/leads/sync (null when idle).
  const [scrapeProgress, setScrapeProgress] = useState<{ pct: number; label: string } | null>(null);
  // Per-action busy tracking: only the clicked button spins, not every button
  // for the lead. `busyActionFor(id)` returns the in-flight action or null.
  const [busy, setBusy] = useState<LeadBusy | null>(null);
  const busyActionFor = useCallback((id: string) => deriveBusyAction(busy, id), [busy]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Leads confirmed as accepted LinkedIn connections (response tracking).
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());
  const [emailConfirmId, setEmailConfirmId] = useState<string | null>(null);
  // Load-more page size: grows the requested feed limit; mergeFeed returns the
  // top-N sorted slice, so raising N appends lower-ranked cards with no dupes.
  const [feedLimit, setFeedLimit] = useState(FEED_PAGE_SIZE);
  // Bulk lead import drawer (CSV / paste).
  const [importOpen, setImportOpen] = useState(false);
  // Header toggle: "feed" is the unified lead list (default); "pipeline" is
  // the CRM funnel view; "setup" is the configuration surface.
  const [view, setView] = useState<'feed' | 'pipeline' | 'setup'>('feed');
  const [companyById, setCompanyById] = useState<Record<string, YcCompanyDetail | 'loading' | 'error'>>({});
  // Full engager records, loaded lazily when an engager card is opened.
  const [engagersById, setEngagersById] = useState<Record<string, WarmContactRow | 'loading'>>({});
  // Inline safety-guard notice per engager (expected 422 block on send).
  const [engagerNotices, setEngagerNotices] = useState<Record<string, string>>({});
  const [draftAll, setDraftAll] = useState<{ done: number; total: number } | null>(null);
  // True when the feed is the built-in demo set (no live scraping key); badged so
  // a user never mistakes seed companies for real leads.
  const [demoData, setDemoData] = useState(false);
  const bootstrapped = useRef(false);
  // Monotonic id shared by loadBootstrap + refetchList. A filter change during
  // the initial bootstrap can fire refetchList concurrently; whichever fetch was
  // started last owns the list, so a stale earlier response is discarded.
  const listFetchSeq = useRef(0);

  useEffect(() => {
    if (searchParams.get('view') === 'setup') {
      setView('setup');
    }
  }, [searchParams]);

  // The pipeline view spans every outreach status, while the feed's default
  // filter only loads 'new' leads - so entering it loads the full workspace.
  useEffect(() => {
    if (view !== 'pipeline') return;
    void fetchWithAuth('/api/leads?status=all')
      .then(async (r) => {
        if (!r.ok) return;
        const d = await r.json();
        indexLeads(d.leads ?? []);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

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
    const seq = ++listFetchSeq.current;
    setLoading(true);
    setLoadError(false);
    setSetupRequired(false);
    setSetupMessage(null);
    try {
      const [feedRes, bootRes] = await Promise.all([
        fetchWithAuth(`/api/leads/feed?${feedQuery()}`),
        fetchWithAuth(`/api/leads/bootstrap?status=${filters.status}`),
      ]);
      const feed = await feedRes.json().catch(() => ({}));
      const boot = await bootRes.json().catch(() => ({}));

      if (feed.setupRequired || boot.setupRequired) {
        setSetupRequired(true);
        setSetupMessage(
          (boot.error as string | undefined) ||
            (feed.error as string | undefined) ||
            'Leads engine not provisioned — contact support',
        );
        setCards([]);
        return;
      }

      if (!feedRes.ok || !bootRes.ok) throw new Error('load failed');
      // Only own the list if a later fetch hasn't superseded this one.
      if (seq === listFetchSeq.current) {
        setCards(feed.cards ?? []);
        indexLeads(boot.leads ?? []);
      }
      setSettings(boot.settings ?? null);
      setProfiles(boot.profiles ?? []);
      setFollowed(boot.followedCompanies ?? []);
      setDemoData(Boolean(boot.demoData));
      // Persist the browser timezone once if the workspace has none. Best-effort:
      // a failure here must not surface as a load error (swallow + ignore).
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz)
        void fetchWithAuth('/api/leads/settings', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ timezone: tz }) }).catch(
          () => {},
        );
    } catch {
      // Distinguish a failed fetch from a genuine empty feed so the UI can offer
      // a retry rather than the misleading "No leads yet today" empty state.
      setLoadError(true);
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
    const seq = ++listFetchSeq.current;
    setListLoading(true);
    try {
      const [feedRes, leadsRes] = await Promise.all([
        fetchWithAuth(`/api/leads/feed?${feedQuery()}`),
        fetchWithAuth(`/api/leads?status=${filters.status}`),
      ]);
      // A non-ok response must not blank the feed to a fake "no leads" state.
      if (!feedRes.ok || !leadsRes.ok) throw new Error('refresh failed');
      const feed = await feedRes.json();
      const leadsData = await leadsRes.json();
      // Discard if a newer fetch (filter change or bootstrap) started meanwhile.
      if (seq !== listFetchSeq.current) return;
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

  // Fetch rich company info the first time a directory lead is opened.
  useEffect(() => {
    if (!selectedId || companyById[selectedId]) return;
    const card = cards.find((c) => c.id === selectedId);
    if (!card || card.kind !== 'directory') return;
    const id = selectedId;
    setCompanyById((m) => ({ ...m, [id]: 'loading' }));
    fetchWithAuth(`/api/leads/${id}/company`)
      .then((r) => {
        if (!r.ok) throw new Error('company fetch failed');
        return r.json();
      })
      .then((d) => setCompanyById((m) => ({ ...m, [id]: (d.company as YcCompanyDetail) ?? null })))
      // Mark as errored (not deleted) so the detail panel can show an inline
      // retry instead of a silently blank card.
      .catch(() => setCompanyById((m) => ({ ...m, [id]: 'error' })));
  }, [selectedId, companyById, cards]);

  // Retry a failed or empty company-info fetch. ?refresh=1 tells the server to
  // bypass the "checked, nothing found" TTL and look again right now.
  const retryCompany = useCallback((id: string) => {
    setCompanyById((m) => ({ ...m, [id]: 'loading' }));
    fetchWithAuth(`/api/leads/${id}/company?refresh=1`)
      .then((r) => {
        if (!r.ok) throw new Error('company fetch failed');
        return r.json();
      })
      .then((d) => setCompanyById((m) => ({ ...m, [id]: (d.company as YcCompanyDetail) ?? null })))
      .catch(() => setCompanyById((m) => ({ ...m, [id]: 'error' })));
  }, []);

  // Load the full engager record the first time an engager card is opened, so
  // the detail pane can show the dossier + current draft. Mirrors companyById.
  useEffect(() => {
    if (!selectedId || engagersById[selectedId]) return;
    const card = cards.find((c) => c.id === selectedId);
    if (!card || card.kind !== 'engager') return;
    const id = selectedId;
    setEngagersById((m) => ({ ...m, [id]: 'loading' }));
    fetchWithAuth(`/api/social-graph/warm-contacts/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error('engager fetch failed');
        return r.json();
      })
      .then((d) => {
        const contact = (d.contact as WarmContactRow) ?? null;
        setEngagersById((m) => ({ ...m, [id]: contact ?? 'loading' }));
        if (contact?.outreach_draft) {
          setDrafts((dd) => (dd[id] ? dd : { ...dd, [id]: contact.outreach_draft as string }));
        }
      })
      .catch(() =>
        setEngagersById((m) => {
          const next = { ...m };
          delete next[id];
          return next;
        }),
      );
  }, [selectedId, engagersById, cards]);

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
  const sortedCards = useMemo(() => {
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

  // Freeze the row order while a detail panel is open. Actions like approve or
  // resolve mutate a card's score (via mergeLead), and re-sorting on score would
  // move the row out from under the user's cursor mid-interaction. We snapshot
  // the order whenever nothing is selected, then reuse it as a stable sort key
  // until the panel closes.
  const frozenOrder = useRef<string[]>([]);
  useEffect(() => {
    if (!selectedId) frozenOrder.current = sortedCards.map((c) => c.id);
  }, [sortedCards, selectedId]);
  const visibleCards = useMemo(() => {
    if (!selectedId) return sortedCards;
    const pos = new Map(frozenOrder.current.map((id, i) => [id, i]));
    // New cards not present at freeze time fall to the end, preserving order.
    return sortedCards
      .slice()
      .sort((a, b) => (pos.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (pos.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  }, [sortedCards, selectedId]);

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
    let succeeded = 0;
    let failed = 0;
    const queue = [...targets];
    const worker = async () => {
      for (let lead = queue.shift(); lead; lead = queue.shift()) {
        try {
          const res = await fetchWithAuth(`/api/leads/${lead.id}/draft`, { method: 'POST', headers: jsonHeaders, body: '{}' });
          const data = await res.json();
          if (res.ok) {
            mergeLead(data.lead);
            setDrafts((d) => ({ ...d, [lead.id]: data.draftText }));
            succeeded += 1;
          } else {
            failed += 1;
          }
        } catch {
          // Count the failure (don't hide it) and keep drafting the rest.
          failed += 1;
        }
        done += 1;
        setDraftAll({ done, total: targets.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, targets.length) }, worker));
    setDraftAll(null);
    const outcome = draftAllOutcome(succeeded, failed);
    toast(outcome.message, outcome.type);
  };

  const handleScrape = async () => {
    setScraping(true);
    setScrapeProgress({ pct: 0, label: 'Starting scrape…' });
    try {
      const res = await fetchWithAuth('/api/leads/sync', { method: 'POST' });
      if (!res.ok || !res.body) {
        // Non-stream error path (auth / no-workspace return plain JSON).
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Scrape failed.');
      }

      // Consume the NDJSON progress stream. Each line is one JSON message; the
      // terminal message is either {type:'result'} or {type:'error'}.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let result: ScrapeResultSummary | null = null;
      let streamError: string | null = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(trimmed);
          } catch {
            continue;
          }
          if (msg.type === 'progress') {
            setScrapeProgress({
              pct: typeof msg.pct === 'number' ? msg.pct : 0,
              label: typeof msg.label === 'string' ? msg.label : 'Working…',
            });
          } else if (msg.type === 'result') {
            result = msg.result as ScrapeResultSummary;
          } else if (msg.type === 'error') {
            streamError = typeof msg.error === 'string' ? msg.error : 'Scrape failed.';
          }
        }
      }

      if (streamError) throw new Error(streamError);
      if (!result) throw new Error('Scrape ended without a result.');

      setScrapeProgress({ pct: 100, label: 'Done' });
      const warnings: string[] = result.warnings ?? [];
      if (result.inserted === 0 && warnings.length > 0) {
        toast(`0 new leads — ${warnings[0]}`, 'error');
      } else if (warnings.length > 0) {
        toast(`${result.inserted} new, but ${warnings.length} source(s) failed: ${warnings[0]}`, 'error');
      } else {
        // Per-source counts make source health visible right after a run.
        const perSource = (result.perSource ?? [])
          .map((p) => `${p.source.replace(/_/g, ' ')} ${p.count}`)
          .join(' / ');
        toast(
          `Scrape done: ${result.inserted} new, ${result.updated} updated, ${result.resolved} resolved${perSource ? ` (${perSource})` : ''}.`,
        );
      }
      await refetchList();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Scrape failed.', 'error');
    } finally {
      setScraping(false);
      setScrapeProgress(null);
    }
  };

  const handleDraft = async (id: string, rewriteInstruction?: string, polish?: boolean) => {
    setBusy({ id, action: 'draft' });
    try {
      const payload: Record<string, unknown> = {};
      if (rewriteInstruction) payload.rewriteInstruction = rewriteInstruction;
      if (polish) payload.polish = true;
      const res = await fetchWithAuth(`/api/leads/${id}/draft`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      mergeLead(data.lead);
      setDrafts((d) => ({ ...d, [id]: data.draftText }));
      toast(polish ? 'Polished.' : rewriteInstruction ? 'Rewritten.' : 'Draft ready.');
    } catch {
      toast('Could not draft.', 'error');
    } finally {
      setBusy(null);
    }
  };

  // Persist user edits to the nurture plan's free-text fields (why/angle/steps).
  const handleEditPlan = async (
    id: string,
    edit: { whyThem?: string; angle?: string; stepLabels?: string[] },
  ) => {
    try {
      const res = await fetchWithAuth(`/api/leads/${id}/playbook`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ edit }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      mergeLead(data.lead);
      toast('Plan updated.');
    } catch {
      toast('Could not update plan.', 'error');
    }
  };

  // Shared by handleApprove and confirmEmailSend so the duplicate-contact 409
  // (Task 10's guard) is handled once, not per caller: on a duplicate block the
  // draft stays put and an inline warning offers "Send anyway" (retries with
  // overrideDuplicate: true) or Cancel, instead of surfacing as an error toast.
  const submitApprove = async (
    id: string,
    channel: ApproveChannel,
    opts: { emailOptIn?: boolean; overrideDuplicate?: boolean; busyAction?: 'approve' | 'email' } = {},
  ) => {
    setBusy({ id, action: opts.busyAction ?? 'approve' });
    setDuplicateWarning((w) => {
      if (!(id in w)) return w;
      const next = { ...w };
      delete next[id];
      return next;
    });
    try {
      // Send the (possibly edited) draft so the edit-feedback loop can capture it.
      const res = await fetchWithAuth(`/api/leads/${id}/approve`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(buildApproveBody(channel, drafts[id], opts)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const duplicate = res.status === 409 ? parseDuplicateResponse(data) : null;
        if (duplicate) {
          setDuplicateWarning((w) => ({
            ...w,
            [id]: { ...duplicate, attemptChannel: channel, emailOptIn: opts.emailOptIn },
          }));
          return;
        }
        throw new Error(data.error || 'blocked');
      }
      mergeLead(data.lead);
      toast(
        channel === 'x_dm'
          ? 'X DM sent.'
          : channel === 'linkedin_dm'
            ? 'Follow-up DM sent.'
            : channel === 'gmail'
              ? 'Email sent.'
              : 'LinkedIn invite sent.',
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not approve.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleApprove = (
    id: string,
    channel: 'linkedin_connect' | 'linkedin_dm' | 'x_dm' = 'linkedin_connect',
  ) => submitApprove(id, channel);

  // "Send anyway" on the inline duplicate warning: retries the same approve
  // call with overrideDuplicate: true (never overrides a do_not_contact block -
  // the approve route re-checks and 409s again if it's a DNC match).
  const handleSendDuplicateAnyway = (id: string) => {
    const warning = duplicateWarning[id];
    if (!warning) return;
    void submitApprove(id, warning.attemptChannel, {
      overrideDuplicate: true,
      emailOptIn: warning.emailOptIn,
      busyAction: warning.attemptChannel === 'gmail' ? 'email' : 'approve',
    });
  };

  const handleCancelDuplicate = (id: string) => {
    setDuplicateWarning((w) => {
      const next = { ...w };
      delete next[id];
      return next;
    });
  };

  // "Never contact again": adds the lead's identity to the workspace
  // do-not-contact list, so future sends to that person hard-block instead of
  // just warning (Task 9's checkPriorContact treats do_not_contact as absolute).
  const handleNeverContact = async (id: string) => {
    setBusy({ id, action: 'dnc' });
    try {
      const res = await fetchWithAuth(`/api/leads/${id}/do-not-contact`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not update.');
      toast(data.skipped ? 'No contact identity to block yet.' : 'Added to do-not-contact list.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add to do-not-contact list.', 'error');
    } finally {
      setBusy(null);
    }
  };

  // Response tracking: has the prospect accepted the LinkedIn connection?
  const handleCheckConnection = async (id: string) => {
    setBusy({ id, action: 'check' });
    try {
      const res = await fetchWithAuth(`/api/leads/${id}/check-connection`, { method: 'POST' });
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

  // Advance the outreach lifecycle past "sent" (replied / closed) so the loop
  // doesn't dead-end. Persists on the outreach row and reflects on the card.
  const handleMarkStage = async (id: string, stage: 'accepted' | 'replied' | 'closed') => {
    setBusy({ id, action: 'stage' });
    try {
      const res = await fetchWithAuth(`/api/leads/${id}/outreach-stage`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ stage }),
      });
      const data = await res.json();
      if (!res.ok || !data.lead) throw new Error(data.error || 'Could not update stage');
      mergeLead(data.lead);
      toast(stage === 'closed' ? 'Lead closed out.' : 'Marked as replied.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update stage.', 'error');
    } finally {
      setBusy(null);
    }
  };

  // Draft the follow-up DM step of the sequence (after a connect is accepted).
  const handleDraftFollowup = async (id: string) => {
    setBusy({ id, action: 'followup' });
    try {
      const res = await fetchWithAuth(`/api/leads/${id}/draft`, {
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

  // Draft a voice-matched reply to a prospect's inbound LinkedIn message. Mirrors
  // handleDraft but hits the reply route so the draft is grounded in the thread.
  const handleDraftReply = async (id: string) => {
    setBusy({ id, action: 'reply' });
    try {
      const res = await fetchWithAuth(`/api/leads/${id}/draft-reply`, { method: 'POST', headers: jsonHeaders, body: '{}' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      mergeLead(data.lead);
      setDrafts((d) => ({ ...d, [id]: data.draftText }));
      toast('Reply drafted — review and send.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not draft reply.', 'error');
    } finally {
      setBusy(null);
    }
  };

  // Send the (edited) reply in the active LinkedIn thread. A 429 is a rate-limit
  // block (surface the retry hint); a 422 means "draft first" - both are expected,
  // not crashes. Uses the 'approve' busy action so the Send reply button spins.
  const handleSendReply = async (id: string) => {
    setBusy({ id, action: 'approve' });
    try {
      const res = await fetchWithAuth(`/api/leads/${id}/reply`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ messageText: drafts[id] }),
      });
      const data = await res.json();
      if (!res.ok) {
        const wait = data.retryAfterSeconds ? ` Try again in ${Math.ceil(data.retryAfterSeconds / 60)} min.` : '';
        throw new Error((data.error ?? 'Could not send reply.') + wait);
      }
      if (data.lead) mergeLead(data.lead);
      toast('Reply sent.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not send reply.', 'error');
    } finally {
      setBusy(null);
    }
  };

  // Cold email is a one-time opt-in; confirm through a styled modal (not a native
  // window.confirm) before the irreversible send.
  const handleEmail = (id: string) => setEmailConfirmId(id);

  const confirmEmailSend = async () => {
    const id = emailConfirmId;
    if (!id) return;
    setEmailConfirmId(null);
    await submitApprove(id, 'gmail', { emailOptIn: true, busyAction: 'email' });
  };

  const handleDismiss = async (id: string) => {
    setBusy({ id, action: 'dismiss' });
    try {
      const res = await fetchWithAuth(`/api/leads/${id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ action: 'dismiss' }) });
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
  // Select-all grabs every currently-visible card; re-clicking clears it.
  const allVisibleSelected =
    visibleCards.length > 0 && visibleCards.every((c) => selectedIds.has(c.id));
  const toggleSelectAll = () => {
    if (allVisibleSelected) clearSelection();
    else setSelectedIds(new Set(visibleCards.map((c) => c.id)));
  };

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
          fetchWithAuth(`/api/leads/${id}`, {
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

  // Download an href as a file without navigating away.
  const triggerDownload = (href: string, download?: string) => {
    const a = document.createElement('a');
    a.href = href;
    if (download) a.download = download;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // Export the whole (status-filtered) workspace via the GET attachment route.
  const exportAll = () => {
    const qs = filters.status !== 'all' ? `?status=${encodeURIComponent(filters.status)}` : '';
    triggerDownload(`/api/leads/export${qs}`);
    toast('Exporting leads to CSV…');
  };

  // Export a specific id subset (POST, since a GET can't carry many UUIDs).
  const exportSelectedIds = async (ids: string[]) => {
    try {
      const res = await fetchWithAuth('/api/leads/export', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ ids, status: filters.status }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      triggerDownload(url, `leads-${new Date().toISOString().slice(0, 10)}.csv`);
      URL.revokeObjectURL(url);
    } catch {
      toast('Could not export.', 'error');
    }
  };

  // Selection-aware export: a partial selection exports just those leads; select
  // all (or nothing selected) exports every lead. Matches the requested rule.
  const handleExport = () => {
    const ids = Array.from(selectedIds);
    const partial = ids.length > 0 && !visibleCards.every((c) => selectedIds.has(c.id));
    if (partial) {
      void exportSelectedIds(ids);
      return;
    }
    exportAll();
  };

  const handleTogglePlaybookStep = async (
    id: string,
    stepIndex: number,
    status: 'pending' | 'done',
  ) => {
    try {
      const res = await fetchWithAuth(`/api/leads/${id}/playbook`, {
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

  const handleSnooze = async (id: string, days: number = 7) => {
    setBusy({ id, action: 'snooze' });
    try {
      const res = await fetchWithAuth(`/api/leads/${id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ action: 'snooze', days }) });
      if (!res.ok) throw new Error();
      // Server hides the lead via snoozed_until; drop from view like dismiss.
      setCards((prev) => prev.filter((c) => c.id !== id));
      setLeadsById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (selectedId === id) setSelectedId(null);
      toast(days === 1 ? 'Snoozed until tomorrow.' : `Snoozed for ${days} days.`);
    } catch {
      toast('Could not snooze.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleResolve = async (id: string, force = false) => {
    setBusy({ id, action: 'resolve' });
    try {
      const res = await fetchWithAuth(`/api/leads/${id}/resolve`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (!res.ok || !data.lead) throw new Error(data.error || 'Resolve failed');
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
      const dres = await fetchWithAuth(`/api/leads/${id}/draft`, { method: 'POST', headers: jsonHeaders, body: '{}' });
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
      const res = await fetchWithAuth(`/api/leads/${id}/playbook`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Plan failed');
      mergeLead(data.lead);
      if (data.lead?.outreach?.draft_text) {
        setDrafts((d) => ({ ...d, [id]: data.lead.outreach.draft_text }));
      }
      toast(
        data.lead?.nurture_stage === 'planned'
          ? 'Plan ready — resolve a contact to start outreach.'
          : 'Nurture plan ready — connect queued.',
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not plan nurture.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleFollowLead = async (lead: SignalLeadWithContacts) => {
    try {
      const res = await fetchWithAuth('/api/leads/followed', {
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

  // --- Actions (engager cards) ---
  // Reload one engager's full record and reflect its stage/status on the feed
  // card so the list + detail stay consistent without a full refetch.
  const refreshEngager = useCallback(async (id: string) => {
    try {
      const res = await fetchWithAuth(`/api/social-graph/warm-contacts/${id}`);
      const data = await res.json();
      const contact = (data.contact as WarmContactRow) ?? null;
      if (!contact) return;
      setEngagersById((m) => ({ ...m, [id]: contact }));
      if (contact.outreach_draft) setDrafts((d) => ({ ...d, [id]: contact.outreach_draft as string }));
      setCards((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                nurtureStage: contact.nurture_stage,
                status: contact.status === 'sent' ? 'sent' : contact.status === 'drafted' ? 'drafted' : c.status,
                score: typeof contact.priority_score === 'number' ? contact.priority_score : c.score,
              }
            : c,
        ),
      );
    } catch {
      // Non-fatal: the card keeps its prior state.
    }
  }, []);

  const handleEngagerPlan = async (id: string) => {
    setBusy({ id, action: 'plan' });
    setEngagerNotices((n) => {
      const next = { ...n };
      delete next[id];
      return next;
    });
    try {
      const res = await fetchWithAuth(`/api/social-graph/warm-contacts/${id}/plan`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Plan failed');
      await refreshEngager(id);
      toast(
        data.path === 'comment'
          ? 'Sequence started — value-add comment queued.'
          : 'Sequence started — connect note drafted.',
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not start sequence.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleEngagerSend = async (id: string, kind: 'connect' | 'dm') => {
    setBusy({ id, action: kind });
    setEngagerNotices((n) => {
      const next = { ...n };
      delete next[id];
      return next;
    });
    try {
      // Persist any inline edits to the draft before sending.
      const draft = drafts[id];
      if (draft?.trim()) {
        await fetchWithAuth(`/api/social-graph/warm-contacts/${id}`, {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify({ draft }),
        }).catch(() => {});
      }
      const path = kind === 'connect' ? 'send' : 'send-dm';
      const res = await fetchWithAuth(`/api/social-graph/warm-contacts/${id}/${path}`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(kind === 'connect' ? { note: draft } : { message: draft }),
      });
      const data = await res.json();
      if (isGuardBlock(res.status)) {
        setEngagerNotices((n) => ({
          ...n,
          [id]: data.error || 'Sending is blocked by your safety settings right now.',
        }));
        return;
      }
      if (!res.ok) throw new Error(data.error || 'send failed');
      await refreshEngager(id);
      toast(kind === 'connect' ? 'Connect invite sent.' : 'Follow-up DM sent.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not send.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleEngagerDismiss = async (id: string) => {
    setBusy({ id, action: 'dismiss' });
    try {
      const res = await fetchWithAuth(`/api/social-graph/warm-contacts/${id}/dismiss`, { method: 'POST' });
      if (!res.ok) throw new Error();
      setCards((prev) => prev.filter((c) => c.id !== id));
      if (selectedId === id) setSelectedId(null);
      toast('Engager dismissed.');
    } catch {
      toast('Could not dismiss.', 'error');
    } finally {
      setBusy(null);
    }
  };

  // --- Selection resolution ---
  const selectedCard = cards.find((c) => c.id === selectedId) ?? null;
  const selectedLead = selectedId ? leadsById[selectedId] ?? null : null;

  // --- Render ---
  const verticals = settings?.icp_verticals ?? [];
  // First-run: the workspace has not described its ICP yet. Drives a guided
  // banner so a brand-new user configures THEIR audience instead of inheriting a
  // default. Only meaningful once settings have loaded.
  const icpConfigured = Boolean(
    settings && (settings.icp_description?.trim() || (settings.icp_verticals?.length ?? 0) > 0),
  );
  // Any filter narrowed away from its default. Distinguishes "no leads at all"
  // (show Scrape now) from "leads exist but filters hide them" (show clear).
  const filtersActive =
    filters.status !== INITIAL_FILTERS.status ||
    filters.source !== 'all' ||
    filters.signalType !== 'all' ||
    filters.vertical !== 'all' ||
    filters.search.trim() !== '';


  return {
    toast, searchParams,
    cards, setCards, leadsById, setLeadsById, settings, setSettings,
    profiles, setProfiles, followed, setFollowed, filters, setFilters,
    selectedId, setSelectedId, drafts, setDrafts, autosaveDraft,
    signalNotices, setSignalNotices, duplicateWarning, setDuplicateWarning,
    loading, setLoading, loadError, setLoadError, setupRequired, setSetupRequired,
    setupMessage, setSetupMessage, listLoading, setListLoading, scraping, setScraping,
    scrapeProgress, setScrapeProgress, busy, setBusy, busyActionFor,
    selectedIds, setSelectedIds, bulkBusy, setBulkBusy, acceptedIds, setAcceptedIds,
    emailConfirmId, setEmailConfirmId, feedLimit, setFeedLimit, importOpen, setImportOpen,
    view, setView, companyById, setCompanyById, engagersById, setEngagersById,
    engagerNotices, setEngagerNotices, draftAll, setDraftAll, demoData, setDemoData,
    feedQuery, indexLeads, loadBootstrap, refetchList, mergeLead,
    retryCompany, refreshEngager, isFollowed, sortedCards, visibleCards,
    handleDraftAll, handleScrape, handleDraft, handleEditPlan, handleApprove,
    handleSendDuplicateAnyway, handleCancelDuplicate, handleNeverContact,
    handleCheckConnection, handleMarkStage, handleDraftFollowup, handleDraftReply, handleSendReply,
    handleEmail, confirmEmailSend,
    handleDismiss, handleExport, handleTogglePlaybookStep, handleSnooze, handleResolve,
    handlePlanNurture, handleFollowLead,
    handleEngagerPlan, handleEngagerSend, handleEngagerDismiss,
    clearSelection, toggleSelect, toggleSelectAll, allVisibleSelected, bulkLeadAction,
    selectedCard, selectedLead,
    icpConfigured, verticals, filtersActive,
  };
}
