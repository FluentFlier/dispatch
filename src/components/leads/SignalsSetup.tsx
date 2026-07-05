'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
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
    working_hours_only: boolean;
  };
  usage: {
    linkedin_invites_today: number;
    linkedin_invites_this_week: number;
    linkedin_inmail_today: number;
  };
  within_working_hours: boolean;
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
  const [enablingSend, setEnablingSend] = useState(false);
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
          <h2 className="text-sm font-semibold text-text-primary">Who to watch ({sources.length})</h2>
          <p className="mt-1 text-xs text-text-secondary">
            Follow founders on X or LinkedIn. When they post about funding or accelerators, they show
            up in your feed.
          </p>
        </div>
        {sources.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {sources.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-primary px-2.5 py-1 text-xs text-text-primary"
              >
                <span className="uppercase text-[10px] text-text-tertiary">{s.platform}</span>
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
              Caps keep outreach within safe daily and weekly limits.
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
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded-md border border-border bg-bg-primary px-3 py-2">
              <dt className="text-text-tertiary">Invites today</dt>
              <dd className="text-text-primary font-medium">
                {safety.usage.linkedin_invites_today} / {safety.settings.max_linkedin_invites_per_day}
              </dd>
            </div>
            <div className="rounded-md border border-border bg-bg-primary px-3 py-2">
              <dt className="text-text-tertiary">Invites this week</dt>
              <dd className="text-text-primary font-medium">
                {safety.usage.linkedin_invites_this_week} /{' '}
                {safety.settings.max_linkedin_invites_per_week}
              </dd>
            </div>
            <div className="rounded-md border border-border bg-bg-primary px-3 py-2">
              <dt className="text-text-tertiary">InMail today</dt>
              <dd className="text-text-primary font-medium">
                {safety.usage.linkedin_inmail_today} / {safety.settings.max_linkedin_inmail_per_day}
              </dd>
            </div>
            <div className="rounded-md border border-border bg-bg-primary px-3 py-2">
              <dt className="text-text-tertiary">Working hours only</dt>
              <dd className="text-text-primary font-medium">
                {safety.settings.working_hours_only ? 'Yes' : 'No'}
              </dd>
            </div>
            <div className="rounded-md border border-border bg-bg-primary px-3 py-2">
              <dt className="text-text-tertiary">Dry run</dt>
              <dd className="text-text-primary font-medium">
                {safety.settings.dry_run ? 'On' : 'Off'}
              </dd>
            </div>
          </dl>
        )}
        <button
          type="button"
          onClick={fetchSafety}
          className="text-xs font-medium text-accent-primary hover:underline"
        >
          Refresh usage
        </button>
      </section>

      {/* --- Integrations --- */}
      <section className="rounded-lg border border-border bg-bg-secondary p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Integrations</h2>
          <p className="mt-1 text-xs text-text-secondary">
            Connect the channels used to notify you and to send outreach.
          </p>
        </div>
        <CalendarConnectionCard />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <IntegrationPill label="LinkedIn" connected={Boolean(linkedIn?.connected)} />
          <IntegrationPill label="Slack" connected={Boolean(slackIntegration?.connected)} />
          <IntegrationPill label="Gmail" connected={Boolean(gmailIntegration?.connected)} />
        </div>
        {slackIntegration?.connected && (
          <p className="text-xs text-text-secondary">
            New-signal Slack alerts: {slackIntegration.config.notify_on_new_signal ? 'on' : 'off'}
            {slackIntegration.config.slack_channel_name
              ? ` (#${slackIntegration.config.slack_channel_name})`
              : ''}
            .
          </p>
        )}
      </section>
    </div>
  );
}

/** Small connected/not-connected status chip for an integration. */
function IntegrationPill({ label, connected }: { label: string; connected: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-bg-primary px-3 py-2">
      <span className="text-text-primary font-medium">{label}</span>
      <span className={connected ? 'text-accent-secondary' : 'text-text-tertiary'}>
        {connected ? 'Connected' : 'Not connected'}
      </span>
    </div>
  );
}
