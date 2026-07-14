'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { SignalsSetupBanner } from '@/components/signals/SignalsSetupBanner';
import { SignalRulesManager } from '@/components/signals/SignalRulesManager';
import CalendarConnectionCard from '@/components/calendar/CalendarConnectionCard';
import type { SignalSourceRow } from '@/lib/signals/types';

/**
 * Safety settings + current-window usage for outreach. Mirrors the shape
 * returned by `GET /api/signals/safety` so the Setup view can show whether
 * sending is armed and how many invites have gone out today/this week.
 */
interface SafetyStatus {
  settings: {
    outreach_enabled: boolean;
    auto_send_enabled: boolean;
    dry_run: boolean;
    max_linkedin_invites_per_day: number;
    max_linkedin_inmail_per_day: number;
    max_linkedin_invites_per_week: number;
    max_x_dm_per_day: number;
    working_hours_only: boolean;
    working_hours_utc_start: number;
    working_hours_utc_end: number;
  };
  usage: {
    linkedin_invites_today: number;
    linkedin_invites_this_week: number;
    linkedin_inmail_today: number;
    x_dm_today: number;
  };
  within_working_hours: boolean;
  last_send_at: string | null;
}

/**
 * A used/cap meter with a fill bar that greens under 70%, ambers 70-90%, and
 * reds at/over the cap - so the workspace can see ban-risk headroom at a glance.
 */
function UsageMeter({ label, used, cap }: { label: string; used: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const remaining = Math.max(0, cap - used);
  const tone =
    pct >= 100 ? 'bg-coral-dark' : pct >= 90 ? 'bg-coral-dark/80' : pct >= 70 ? 'bg-amber-500' : 'bg-accent-secondary';
  return (
    <div className="rounded-md border border-border bg-bg-primary px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-text-tertiary text-[11px]">{label}</span>
        <span className="text-text-primary font-medium text-[11px]">{used}/{cap}</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full rounded-full bg-bg-tertiary overflow-hidden">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[10px] text-text-tertiary">{remaining} left</p>
    </div>
  );
}

/** Connection state for LinkedIn sending, from `GET /api/signals/linkedin`. */
interface LinkedInStatus {
  connected: boolean;
  inmail?: { available: number | null } | null;
}

/** One integration row (Slack / Gmail / Google Calendar) from the API. */
interface IntegrationStatus {
  toolkit: 'slack' | 'gmail' | 'googlecalendar';
  connected: boolean;
  enabled: boolean;
  config: {
    slack_channel_id?: string;
    slack_channel_name?: string;
    notify_on_new_signal?: boolean;
  };
}

/**
 * Signal configuration surface for the unified `/leads` page Setup tab.
 *
 * Hosts everything that used to live on the standalone `/signals` page EXCEPT
 * the (now redundant) events feed: tracked Sources, trigger Rules, Safety
 * settings + usage, and Integrations (Slack / Gmail / Calendar + LinkedIn
 * status). It loads its own state from the same `/api/signals/*` endpoints the
 * old page used so the backend contract is unchanged. WHY a self-contained
 * component: the unified feed owns event data now, so config must load
 * independently rather than piggy-backing on a shared bootstrap.
 */
export function SignalsSetup() {
  const [sources, setSources] = useState<SignalSourceRow[]>([]);
  const [safety, setSafety] = useState<SafetyStatus | null>(null);
  const [linkedIn, setLinkedIn] = useState<LinkedInStatus | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [newSourceHandle, setNewSourceHandle] = useState('');
  const [newSourcePlatform, setNewSourcePlatform] = useState<'x' | 'linkedin'>('x');
  const [newKeyword, setNewKeyword] = useState('');
  const [removingKeywordId, setRemovingKeywordId] = useState<string | null>(null);
  const [enablingSend, setEnablingSend] = useState(false);
  const [togglingAuto, setTogglingAuto] = useState(false);
  const [connectingToolkit, setConnectingToolkit] = useState<'slack' | 'gmail' | null>(null);
  const [composioConfigured, setComposioConfigured] = useState(true);
  const loaded = useRef(false);

  // --- Data loading (same endpoints as the retired /signals page) ---
  /** Loads sources, safety, LinkedIn status, and integrations in parallel. */
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sourcesRes, safetyRes, linkedInRes, integrationsRes] = await Promise.all([
        fetch('/api/signals/sources', { credentials: 'same-origin' }),
        fetch('/api/signals/safety', { credentials: 'same-origin' }),
        fetch('/api/signals/linkedin', { credentials: 'same-origin' }),
        fetch('/api/signals/integrations', { credentials: 'same-origin' }),
      ]);
      if (sourcesRes.ok) {
        const data = await sourcesRes.json();
        setSources(data.sources ?? []);
      }
      if (safetyRes.ok) setSafety(await safetyRes.json());
      if (linkedInRes.ok) setLinkedIn(await linkedInRes.json());
      if (integrationsRes.ok) {
        const data = await integrationsRes.json();
        setIntegrations((data.integrations ?? []) as IntegrationStatus[]);
        setComposioConfigured(Boolean(data.composio_configured));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load setup.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void loadAll();
  }, [loadAll]);

  /** Refreshes just the safety block after an outreach setting changes. */
  const fetchSafety = useCallback(async () => {
    try {
      const res = await fetch('/api/signals/safety', { credentials: 'same-origin' });
      if (res.ok) setSafety(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not refresh safety.');
    }
  }, []);

  /**
   * Arms outreach: turns on sending, disables dry run, and drops the
   * working-hours gate so a draft can be approved immediately.
   */
  const enableSending = async () => {
    setEnablingSend(true);
    setError(null);
    try {
      const res = await fetch('/api/signals/safety', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outreach_enabled: true,
          dry_run: false,
          working_hours_only: false,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Could not turn on sending');
      }
      setSafety(await res.json());
      setSuccess('Sending is on. Draft a message from a lead, then approve when it feels right.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn on sending');
    } finally {
      setEnablingSend(false);
    }
  };

  const toggleAutoSend = async () => {
    if (!safety) return;
    setTogglingAuto(true);
    setError(null);
    try {
      const next = !safety.settings.auto_send_enabled;
      const res = await fetch('/api/signals/safety', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auto_send_enabled: next,
          ...(next ? { outreach_enabled: true, dry_run: false } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Could not update auto-send.');
      }
      setSafety(await res.json());
      setSuccess(
        next
          ? 'Auto-connect on. New ICP leads get playbooks + timed LinkedIn invites (daily/weekly caps apply).'
          : 'Auto-connect off. Approve each connect manually.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update auto-send.');
    } finally {
      setTogglingAuto(false);
    }
  };

  /** Starts Composio OAuth for Gmail or Slack (same flow as onboarding). */
  const connectComposio = async (toolkit: 'slack' | 'gmail') => {
    if (!composioConfigured) {
      setError('Composio is not configured on this deployment.');
      return;
    }
    setConnectingToolkit(toolkit);
    setError(null);
    try {
      const res = await fetch(`/api/integrations/composio/link?toolkit=${toolkit}`);
      const data = await res.json();
      if (!res.ok || !data.redirect_url) {
        throw new Error(data.error ?? `Could not start ${toolkit} connect.`);
      }
      window.location.href = data.redirect_url as string;
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not connect ${toolkit}.`);
      setConnectingToolkit(null);
    }
  };

  /** Adds a tracked account to the watchlist and keeps the local list in sync. */
  const handleAddSource = async () => {
    if (!newSourceHandle.trim()) return;
    setError(null);
    try {
      const res = await fetch('/api/signals/sources', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: newSourcePlatform,
          handle_or_url: newSourceHandle.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Could not add source');
      }
      const data = await res.json().catch(() => ({}));
      if (data.source) setSources((prev) => [...prev, data.source as SignalSourceRow]);
      setNewSourceHandle('');
      setSuccess('Added to your watchlist.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add source');
    }
  };

  /** Per-workspace topic cap; keep in sync with MAX_KEYWORD_SOURCES in the sources API. */
  const MAX_TOPICS = 5;

  /** Adds a monitored keyword/hashtag (an X keyword_search source). */
  const handleAddKeyword = async () => {
    const keyword = newKeyword.trim();
    if (!keyword) return;
    setError(null);
    try {
      const res = await fetch('/api/signals/sources', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'x',
          handle_or_url: keyword,
          source_type: 'keyword_search',
          label: keyword,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Could not add topic');
      }
      const data = await res.json().catch(() => ({}));
      if (data.source) setSources((prev) => [...prev, data.source as SignalSourceRow]);
      setNewKeyword('');
      setSuccess('Topic added. New posts about it will surface as leads within the hour.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add topic');
    }
  };

  /** Stops monitoring a topic (deletes the keyword_search source). */
  const handleRemoveKeyword = async (id: string) => {
    setRemovingKeywordId(id);
    setError(null);
    try {
      const res = await fetch(`/api/signals/sources/${id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Could not remove topic');
      }
      setSources((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove topic');
    } finally {
      setRemovingKeywordId(null);
    }
  };

  const accountSources = sources.filter((s) => s.source_type !== 'keyword_search');
  const keywordSources = sources.filter((s) => s.source_type === 'keyword_search');

  const setupState = {
    hasSources: sources.length > 0,
    linkedInConnected: Boolean(linkedIn?.connected),
    sendingReady:
      Boolean(safety?.settings.outreach_enabled && !safety?.settings.dry_run) &&
      (!safety?.settings.working_hours_only || Boolean(safety?.within_working_hours)),
    dryRun: Boolean(safety?.settings.dry_run),
    outreachEnabled: Boolean(safety?.settings.outreach_enabled),
  };

  const slackIntegration = integrations.find((i) => i.toolkit === 'slack');
  const gmailIntegration = integrations.find((i) => i.toolkit === 'gmail');

  if (loading) {
    return <p className="text-sm text-text-tertiary">Loading setup…</p>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-md px-3 py-2">
          {success}
        </p>
      )}

      <SignalsSetupBanner
        setup={setupState}
        enablingSend={enablingSend}
        onEnableSending={enableSending}
      />

      {/* --- Sources: who to watch --- */}
      <section className="rounded-lg border border-border bg-bg-secondary p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Who to watch ({accountSources.length})</h2>
          <p className="mt-1 text-xs text-text-secondary">
            Follow founders on X or LinkedIn. When they post about funding or accelerators, they show
            up in your feed.
          </p>
        </div>
        {accountSources.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {accountSources.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-primary px-2.5 py-1 text-xs text-text-primary"
              >
                <span className="text-[10px] text-text-tertiary">{s.platform}</span>
                {s.label || s.handle_or_url}
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <select
            value={newSourcePlatform}
            onChange={(e) => setNewSourcePlatform(e.target.value as 'x' | 'linkedin')}
            className="text-xs rounded-md border border-border bg-bg-primary px-2 py-2 min-h-[40px]"
            aria-label="Platform"
          >
            <option value="x">X</option>
            <option value="linkedin">LinkedIn</option>
          </select>
          <input
            type="text"
            placeholder="@handle or profile URL"
            value={newSourceHandle}
            onChange={(e) => setNewSourceHandle(e.target.value)}
            className="flex-1 min-w-[160px] text-sm rounded-md border border-border bg-bg-primary px-3 py-2 min-h-[40px]"
          />
          <button
            type="button"
            onClick={handleAddSource}
            className="inline-flex items-center gap-1 text-sm font-medium px-3 py-2 rounded-md bg-accent-primary text-white min-h-[40px]"
          >
            <Plus className="h-4 w-4" />
            Follow
          </button>
        </div>
      </section>

      {/* --- Topics: keywords to monitor on X --- */}
      <section className="rounded-lg border border-border bg-bg-secondary p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">
            Topics to monitor ({keywordSources.length} of {MAX_TOPICS})
          </h2>
          <p className="mt-1 text-xs text-text-secondary">
            We check X for new posts about each topic roughly every hour and surface the authors as
            leads.
          </p>
        </div>
        {keywordSources.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {keywordSources.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-primary px-2.5 py-1 text-xs text-text-primary"
              >
                {s.label || s.handle_or_url}
                <button
                  type="button"
                  onClick={() => handleRemoveKeyword(s.id)}
                  disabled={removingKeywordId === s.id}
                  aria-label={`Stop monitoring ${s.label || s.handle_or_url}`}
                  className="text-text-tertiary hover:text-text-primary disabled:opacity-50"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder={'keyword or #hashtag - e.g. "building in public"'}
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleAddKeyword();
            }}
            className="flex-1 min-w-[160px] text-sm rounded-md border border-border bg-bg-primary px-3 py-2 min-h-[40px]"
          />
          <button
            type="button"
            onClick={handleAddKeyword}
            disabled={keywordSources.length >= MAX_TOPICS}
            className="inline-flex items-center gap-1 text-sm font-medium px-3 py-2 rounded-md bg-accent-primary text-white min-h-[40px] disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Monitor
          </button>
        </div>
      </section>

      {/* --- Trigger rules --- */}
      <section className="rounded-lg border border-border bg-bg-secondary p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Automation rules</h2>
          <p className="mt-1 text-xs text-text-secondary">
            Decide which signals auto-draft, and which can auto-send.
          </p>
        </div>
        <SignalRulesManager />
      </section>

      {/* --- Safety + usage --- */}
      <section className="rounded-lg border border-border bg-bg-secondary p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Sending &amp; safety</h2>
            <p className="mt-1 text-xs text-text-secondary">
              Sending is {safety?.settings.outreach_enabled && !safety?.settings.dry_run ? 'on' : 'off'}.
              Caps keep outreach within safe daily and weekly limits. Actions are spaced randomly (Unipile
              recommends ≥2 min between sends, comments scheduled inside working hours) to reduce ban risk.
            </p>
          </div>
          {(!safety?.settings.outreach_enabled || safety?.settings.dry_run) && (
            <button
              type="button"
              onClick={enableSending}
              disabled={enablingSend}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md bg-accent-primary text-white disabled:opacity-50 min-h-[40px] shrink-0"
            >
              {enablingSend ? 'Turning on…' : 'Turn on sending'}
            </button>
          )}
        </div>
        {safety && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <UsageMeter label="Invites today" used={safety.usage.linkedin_invites_today} cap={safety.settings.max_linkedin_invites_per_day} />
              <UsageMeter label="Invites this week" used={safety.usage.linkedin_invites_this_week} cap={safety.settings.max_linkedin_invites_per_week} />
              <UsageMeter label="InMail today" used={safety.usage.linkedin_inmail_today} cap={safety.settings.max_linkedin_inmail_per_day} />
              <UsageMeter label="X DMs today" used={safety.usage.x_dm_today} cap={safety.settings.max_x_dm_per_day} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${safety.settings.dry_run ? 'bg-amber-500/10 text-amber-600' : 'bg-sage-light text-accent-secondary'}`}>
                {safety.settings.dry_run ? 'Dry-run (drafts only)' : 'Live sending'}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${safety.within_working_hours ? 'bg-sage-light text-accent-secondary' : 'bg-bg-tertiary text-text-tertiary'}`}>
                {safety.settings.working_hours_only
                  ? safety.within_working_hours
                    ? 'Within working hours'
                    : `Paused · sends UTC ${safety.settings.working_hours_utc_start}:00–${safety.settings.working_hours_utc_end}:00`
                  : 'Working hours off (sends anytime)'}
              </span>
              {safety.last_send_at && (
                <span className="text-text-tertiary">
                  Last send {new Date(safety.last_send_at).toLocaleString()}
                </span>
              )}
            </div>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={toggleAutoSend}
            disabled={togglingAuto || !safety}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border border-border bg-bg-primary hover:border-accent-primary/40 disabled:opacity-50 min-h-[40px]"
          >
            {togglingAuto
              ? 'Updating…'
              : safety?.settings.auto_send_enabled
                ? 'Turn off auto-connect'
                : 'Enable auto-connect'}
          </button>
          <button
            type="button"
            onClick={fetchSafety}
            className="text-xs font-medium text-accent-primary hover:underline min-h-[40px] px-2"
          >
            Refresh usage
          </button>
        </div>
      </section>

    </div>
  );
}

/** Small connected/not-connected status chip for an integration. */
function IntegrationPill({
  label,
  connected,
  onConnect,
  connecting,
}: {
  label: string;
  connected: boolean;
  onConnect?: () => void;
  connecting?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-bg-primary px-3 py-2">
      <span className="text-text-primary font-medium">{label}</span>
      {connected ? (
        <span className="text-accent-secondary">Connected</span>
      ) : onConnect ? (
        <button
          type="button"
          onClick={onConnect}
          disabled={connecting}
          className="text-accent-primary font-medium hover:underline disabled:opacity-60"
        >
          {connecting ? 'Connecting…' : 'Connect'}
        </button>
      ) : (
        <span className="text-text-tertiary">Not connected</span>
      )}
    </div>
  );
}
