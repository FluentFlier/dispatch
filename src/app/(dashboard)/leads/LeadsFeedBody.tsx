'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { FeedFilters, type FeedFilterState } from '@/components/leads/FeedFilters';
import { UnifiedFeed } from '@/components/leads/UnifiedFeed';
import { LeadDetail } from '@/components/leads/LeadDetail';
import { EngagerDetail, type EngagerDetailAction } from '@/components/leads/EngagerDetail';
import { SignalsSetup } from '@/components/leads/SignalsSetup';
import { IcpManager } from '@/components/leads/IcpManager';
import { LeadSourcesCard } from '@/components/leads/LeadSourcesCard';
import { LeadDeliveryCard } from '@/components/leads/LeadDeliveryCard';
import { SlackConnectionCard } from '@/components/leads/SlackConnectionCard';
import { LeadImportDrawer } from '@/components/leads/LeadImportDrawer';
import {
  LeadsHeaderActions,
  LeadsEmptyState,
  LeadsFilteredEmptyState,
  ScrapeProgress,
} from '@/components/leads/LeadsFeedChrome';
import type { LeadDetailAction } from '@/lib/leads/busy';
import { feedViewState, PIPELINE_COLUMNS, pipelineColumn } from '@/lib/leads/feed-view';
import { nurtureStageLabel } from '@/components/leads/feed-format';
import { useLeadsController } from './useLeadsController';

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
 * Signal types that can only ever come from the live Signal engine (X/LinkedIn
 * post detection), never from a directory scrape. When one of these is selected
 * and the feed is empty, the filtered-empty state explains that gap instead of
 * misleadingly offering "Scrape now". 'launch' is intentionally excluded - it
 * now maps to Product Hunt / YC-launch directory leads too.
 */
const SIGNAL_ENGINE_ONLY_TYPES = new Set<string>([
  'funding_round',
  'role_change',
  'accelerator_join',
  'keyword_match',
]);

type LeadsController = ReturnType<typeof useLeadsController>;

/**
 * Presentational half of the leads page: renders the header, unified feed, the
 * directory / signal / engager detail panels, the advanced drawer, and the
 * email-confirm modal. All state and behavior come from `useLeadsController`,
 * spread in as props, so this component holds only view logic.
 */
export function LeadsFeedBody(props: LeadsController) {
  const {
    toast,
    cards, settings, setSettings, profiles, setProfiles, followed, setFollowed,
    filters, setFilters, selectedId, setSelectedId, drafts, setDrafts, autosaveDraft, leadsById,
    loading, loadError, setupRequired, setupMessage, listLoading, scraping, scrapeProgress,
    busyActionFor, selectedIds, bulkBusy, acceptedIds, emailConfirmId, setEmailConfirmId,
    planConfirmId, setPlanConfirmId, confirmPlanNurture,
    feedLimit, setFeedLimit, importOpen, setImportOpen, view, setView,
    companyById, engagersById, engagerNotices, draftAll, demoData,
    loadBootstrap, refetchList, retryCompany, isFollowed, visibleCards,
    handleDraftAll, handleScrape, handleDraft, handleEditPlan, handleApprove,
    duplicateWarning, handleSendDuplicateAnyway, handleCancelDuplicate, handleNeverContact,
    handleCheckConnection, handleMarkStage, handleDraftFollowup, handleDraftReply, handleSendReply,
    handleEmail, confirmEmailSend,
    handleDismiss, handleExport, handleTogglePlaybookStep, handleSnooze, handleResolve,
    handlePlanNurture, handleFollowLead,
    handleEngagerPlan, handleEngagerSend, handleEngagerDismiss,
    clearSelection, toggleSelect, toggleSelectAll, allVisibleSelected, bulkLeadAction,
    selectedCard, selectedLead,
    icpConfigured, verticals, filtersActive,
  } = props;

  // Bumped whenever the ICP changes so the Signals card (Topics to monitor)
  // reloads and reflects keywords the assistant just mirrored in.
  const [signalsRefreshKey, setSignalsRefreshKey] = useState(0);
  const handleIcpSettingsSaved = (s: Parameters<typeof setSettings>[0]) => {
    setSettings(s);
    setSignalsRefreshKey((k) => k + 1);
  };

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
            onExport={handleExport}
            onImport={() => setImportOpen(true)}
          />
        }
      />

      {/* Feed | Pipeline | Setup segmented control */}
      <div className="inline-flex rounded-md border border-border bg-bg-secondary p-1 gap-1">
        {(['feed', 'pipeline', 'setup'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors min-h-[36px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary ${
              view === v ? 'bg-accent-primary text-white' : 'text-text-secondary hover:text-text-primary'
            }`}
            aria-pressed={view === v}
          >
            {v === 'feed' ? 'Feed' : v === 'pipeline' ? 'Pipeline' : 'Setup'}
          </button>
        ))}
      </div>

      {view === 'pipeline' ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {PIPELINE_COLUMNS.map((col) => {
            const items = Object.values(leadsById).filter((l) => pipelineColumn(l) === col.key);
            return (
              <div key={col.key} className="rounded-lg border border-border bg-bg-secondary p-3 space-y-2 min-h-[140px]">
                <p className="text-xs font-semibold text-text-primary">
                  {col.label} <span className="text-text-tertiary font-normal">({items.length})</span>
                </p>
                {items.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(l.id);
                      setView('feed');
                      setFilters((f) => ({ ...f, status: 'all' }));
                    }}
                    className="w-full text-left rounded-md border border-border bg-bg-primary px-2.5 py-2 hover:border-accent-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                  >
                    <p className="text-sm font-medium text-text-primary truncate">{l.company_name}</p>
                    <p className="text-xs text-text-tertiary truncate">
                      {nurtureStageLabel(l.nurture_stage) ?? l.lead_status}
                      {l.needs_reply ? ' - needs reply' : ''}
                    </p>
                  </button>
                ))}
                {items.length === 0 && <p className="text-xs text-text-tertiary italic">Empty</p>}
              </div>
            );
          })}
        </div>
      ) : view === 'setup' ? (
        <div className="space-y-6">
          {/* Basics - the two things a user must set to get relevant leads: who to
              reach (ICP) and where to look (sources). Everything else is under
              "Advanced" below so the surface isn't a wall of ~20 fields.
              The old Setup "Scrape now" button was a duplicate of the ICP chat's
              "Find leads now" (both POST /api/leads/sync); it's dropped here, and
              the Feed header keeps the scrape control for the feed surface. */}
          <IcpManager
            settings={settings}
            profiles={profiles}
            onProfilesChange={setProfiles}
            onSettingsSaved={handleIcpSettingsSaved}
            onDiscoveryComplete={() => void loadBootstrap()}
            toast={toast}
          />
          <LeadSourcesCard
            settings={settings}
            followed={followed}
            onSettingsSaved={setSettings}
            onFollowedChange={setFollowed}
            toast={toast}
          />

          {/* Advanced - delivery timing, signal engine + sending safety, and Slack
              alerts. Collapsed by default (native <details>) so first-run users
              aren't buried; power users expand when they need it. */}
          <details className="group rounded-lg border border-border bg-bg-secondary [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 select-none list-none">
              <div>
                <h2 className="text-sm font-semibold text-text-primary">Advanced</h2>
                <p className="mt-0.5 text-xs text-text-secondary">
                  Delivery timing, signals &amp; sending safety, and Slack alerts.
                </p>
              </div>
              <ChevronDown className="h-4 w-4 shrink-0 text-text-tertiary transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-6 border-t border-border px-4 py-4">
              <SignalsSetup refreshKey={signalsRefreshKey} />
              {/* Without a channel set here, every Slack send (digest + instant) silently no-ops. */}
              <SlackConnectionCard />
              {settings && (
                <LeadDeliveryCard settings={settings} onSettingsSaved={setSettings} toast={toast} />
              )}
            </div>
          </details>
        </div>
      ) : (
      <>
      {/* First-run guidance: no ICP yet -> point the user at Setup to describe
          who THEY want to reach (writes signal_directory_settings via IcpChat). */}
      {!loading && !icpConfigured && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-accent-primary/30 bg-accent-primary/5 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary">Tell us who you want to reach</p>
            <p className="text-xs text-text-secondary">
              Set your ideal customer profile so these leads match your market, not a generic default.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setView('setup')}
            className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-md bg-accent-primary text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          >
            Set up your ICP
          </button>
        </div>
      )}
      {/* Demo-data notice: the feed is the built-in seed set, not live scrapes. */}
      {!loading && demoData && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-50/60 px-4 py-2 text-xs text-amber-800">
          <span className="inline-flex items-center rounded-full bg-amber-400/20 px-2 py-0.5 font-medium uppercase tracking-wide">
            Demo data
          </span>
          <span>These are sample companies. Connect live scraping to see real leads for your ICP.</span>
        </div>
      )}
      <FeedFilters state={filters} onChange={setFilters} verticals={verticals} />

      {/* Live scrape progress above an already-populated feed. The empty-feed
          case shows the big panel variant in the empty branch below instead. */}
      {scraping && scrapeProgress && cards.length > 0 && (
        <ScrapeProgress pct={scrapeProgress.pct} label={scrapeProgress.label} />
      )}

      {feedViewState({ loading, loadError, cardCount: cards.length, setupRequired }) === 'loading' ? (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 min-h-[480px]">
          <div className="lg:col-span-2">
            <UnifiedFeed cards={[]} selectedId={null} loading onSelect={() => {}} isFollowed={() => false} />
          </div>
          <div className="lg:col-span-3 border border-border rounded-lg bg-bg-secondary p-5 hidden lg:flex items-center justify-center text-text-tertiary text-sm">
            Loading leads…
          </div>
        </div>
      ) : feedViewState({ loading, loadError, cardCount: cards.length, setupRequired }) === 'setup' ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-bg-secondary py-16 text-center px-6">
          <p className="text-sm text-text-primary font-medium">
            {setupMessage ?? 'Leads engine not provisioned - contact support'}
          </p>
          <p className="text-xs text-text-tertiary max-w-md">
            This workspace cannot load leads until the signals schema is applied. If you are an operator, apply{' '}
            <code className="font-mono">db/signals.sql</code> and{' '}
            <code className="font-mono">db/signals-leads.sql</code>, then enable{' '}
            <code className="font-mono">signals_engine</code>.
          </p>
          <button
            type="button"
            onClick={() => void loadBootstrap()}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-accent-primary text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          >
            Retry
          </button>
        </div>
      ) : feedViewState({ loading, loadError, cardCount: cards.length, setupRequired }) === 'error' ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-bg-secondary py-16 text-center">
          <p className="text-sm text-text-secondary">Could not load your leads.</p>
          <button
            type="button"
            onClick={() => void loadBootstrap()}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-accent-primary text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          >
            Retry
          </button>
        </div>
      ) : feedViewState({ loading, loadError, cardCount: cards.length, setupRequired }) === 'empty' ? (
        scraping && scrapeProgress ? (
          <ScrapeProgress pct={scrapeProgress.pct} label={scrapeProgress.label} panel />
        ) : filtersActive ? (
          <LeadsFilteredEmptyState
            onClear={() => setFilters(INITIAL_FILTERS)}
            signalHint={SIGNAL_ENGINE_ONLY_TYPES.has(filters.signalType)}
          />
        ) : (
          <LeadsEmptyState onScrape={handleScrape} scraping={scraping} />
        )
      ) : visibleCards.length === 0 ? (
        // Server returned leads, but a client-side filter (search / vertical)
        // hides them all - explain + offer clear instead of a blank list.
        <LeadsFilteredEmptyState
          onClear={() => setFilters(INITIAL_FILTERS)}
          signalHint={SIGNAL_ENGINE_ONLY_TYPES.has(filters.signalType)}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 min-h-[480px]">
          {/* List */}
          <div className="lg:col-span-2 space-y-2">
            {selectedIds.size > 0 && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-accent-primary/30 bg-accent-primary/5 px-3 py-2">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-text-primary">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allVisibleSelected;
                    }}
                    onChange={toggleSelectAll}
                    className="h-3.5 w-3.5 cursor-pointer accent-accent-primary"
                  />
                  {allVisibleSelected ? `All ${visibleCards.length} selected` : `${selectedIds.size} selected`}
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleExport}
                    className="text-xs px-2 py-1 rounded-md border border-border bg-bg-secondary hover:bg-bg-primary text-text-secondary"
                  >
                    Export
                  </button>
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
            {selectedCard?.kind === 'engager' ? (
              <EngagerDetail
                card={selectedCard}
                contact={engagersById[selectedCard.id] ?? null}
                draft={drafts[selectedCard.id] ?? ''}
                onDraftChange={(v) => setDrafts((d) => ({ ...d, [selectedCard.id]: v }))}
                busyAction={busyActionFor(selectedCard.id) as EngagerDetailAction | null}
                notice={engagerNotices[selectedCard.id] ?? null}
                onPlan={() => handleEngagerPlan(selectedCard.id)}
                onSendConnect={() => handleEngagerSend(selectedCard.id, 'connect')}
                onSendDm={() => handleEngagerSend(selectedCard.id, 'dm')}
                onDismiss={() => handleEngagerDismiss(selectedCard.id)}
              />
            ) : selectedLead ? (
              // Keyed by lead id so switching leads remounts the panel (resets
              // the Activity accordion + textarea state instead of leaking the
              // previous lead's). Renders off selectedLead, not the card list:
              // a pipeline click must open even when the lead ranks below the
              // feed's current page slice.
              <LeadDetail
                key={selectedLead.id}
                lead={selectedLead}
                company={companyById[selectedLead.id]}
                onRetryCompany={() => retryCompany(selectedLead.id)}
                draft={
                  drafts[selectedLead.id] ??
                  selectedLead.outreach?.edited_draft_text ??
                  selectedLead.outreach?.draft_text ??
                  ''
                }
                onDraftChange={(v) => autosaveDraft(selectedLead.id, v)}
                busyAction={busyActionFor(selectedLead.id) as LeadDetailAction | null}
                followed={followed.some(
                  (f) =>
                    (selectedLead.domain && f.domain === selectedLead.domain) ||
                    f.company_name === selectedLead.company_name,
                )}
                onDraft={(rewriteInstruction) => handleDraft(selectedLead.id, rewriteInstruction)}
                onPolish={() => handleDraft(selectedLead.id, undefined, true)}
                onApprove={(channel) => handleApprove(selectedLead.id, channel)}
                duplicateWarning={duplicateWarning[selectedLead.id] ?? null}
                onSendDuplicateAnyway={() => handleSendDuplicateAnyway(selectedLead.id)}
                onCancelDuplicate={() => handleCancelDuplicate(selectedLead.id)}
                onNeverContact={() => handleNeverContact(selectedLead.id)}
                onEmail={() => handleEmail(selectedLead.id)}
                onDismiss={() => handleDismiss(selectedLead.id)}
                onSnooze={(days) => handleSnooze(selectedLead.id, days)}
                onResolve={(force?: boolean) => handleResolve(selectedLead.id, force ?? false)}
                onFollow={() => handleFollowLead(selectedLead)}
                onPlanNurture={() => handlePlanNurture(selectedLead.id)}
                onEditPlan={(edit) => handleEditPlan(selectedLead.id, edit)}
                onToggleStep={(stepIndex, status) =>
                  handleTogglePlaybookStep(selectedLead.id, stepIndex, status)
                }
                onDraftFollowup={() => handleDraftFollowup(selectedLead.id)}
                onCheckConnection={() => handleCheckConnection(selectedLead.id)}
                onDraftReply={() => handleDraftReply(selectedLead.id)}
                onSendReply={() => handleSendReply(selectedLead.id)}
                accepted={
                  acceptedIds.has(selectedLead.id) ||
                  ['accepted', 'replied', 'closed'].includes(selectedLead.outreach?.status ?? '')
                }
                onMarkReplied={() => handleMarkStage(selectedLead.id, 'replied')}
                onMarkClosed={() => handleMarkStage(selectedLead.id, 'closed')}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
                Select a lead to review.
              </div>
            )}
          </div>
        </div>
      )}
      </>
      )}

      <LeadImportDrawer
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onComplete={() => {
          void loadBootstrap();
          void refetchList();
        }}
        toast={toast}
      />

      <ConfirmModal
        open={planConfirmId !== null}
        title="Plan outreach"
        message="This researches them and drafts AI comments on their recent posts. Nothing is posted - drafts wait for your approval in Comments to approve."
        confirmLabel="Draft the plan"
        onConfirm={() => void confirmPlanNurture()}
        onClose={() => setPlanConfirmId(null)}
      />

      <ConfirmModal
        open={emailConfirmId !== null}
        title="Send cold email"
        message="Send a cold email to this lead? This is a one-time opt-in; an unsubscribe line is added automatically."
        confirmLabel="Send email"
        onConfirm={() => void confirmEmailSend()}
        onClose={() => setEmailConfirmId(null)}
      />
    </div>
  );
}
