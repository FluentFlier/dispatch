'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Radio,
  ExternalLink,
  Sparkles,
  X,
  Send,
  RefreshCw,
  Plus,
  TrendingUp,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { SignalsSetupBanner } from '@/components/signals/SignalsSetupBanner';
import { linkedInIdentifierFromSignal } from '@/lib/signals/linkedin-identifier';
import type { SignalEventWithPost, SignalSourceRow } from '@/lib/signals/types';

type StatusFilter = 'pending' | 'drafted' | 'sent' | 'all';
type SendChannel = 'linkedin_connect' | 'linkedin_dm' | 'gmail';

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

interface LinkedInStatus {
  connected: boolean;
  inmail?: { available: number | null } | null;
}

const SIGNAL_LABELS: Record<string, string> = {
  accelerator_join: 'Accelerator',
  funding_round: 'Funding',
  role_change: 'New role',
  launch: 'Launch',
  other: 'Update',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'New',
  drafted: 'Ready to send',
  sent: 'Sent',
  failed: 'Couldn’t send',
  dismissed: 'Archived',
};

const FILTER_LABELS: Record<StatusFilter, string> = {
  pending: 'New',
  drafted: 'Ready',
  sent: 'Sent',
  all: 'All',
};

const DEMO_SEED =
  'Excited to announce we joined Y Combinator W26! Building the future of fintech for startups.';

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

function draftChannelForSend(channel: SendChannel): SendChannel | 'copy' {
  if (channel === 'gmail') return 'gmail';
  if (channel === 'linkedin_connect') return 'linkedin_connect';
  if (channel === 'linkedin_dm') return 'linkedin_dm';
  return 'copy';
}

export default function SignalsPage() {
  const [events, setEvents] = useState<SignalEventWithPost[]>([]);
  const [sources, setSources] = useState<SignalSourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [demoSeeding, setDemoSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [safety, setSafety] = useState<SafetyStatus | null>(null);
  const [linkedIn, setLinkedIn] = useState<LinkedInStatus | null>(null);
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [sendChannel, setSendChannel] = useState<SendChannel>('linkedin_connect');
  const [newSourceHandle, setNewSourceHandle] = useState('');
  const [newSourcePlatform, setNewSourcePlatform] = useState<'x' | 'linkedin'>('x');
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [lastVoiceScore, setLastVoiceScore] = useState<number | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [enablingSend, setEnablingSend] = useState(false);

  const fetchSafety = useCallback(async () => {
    try {
      const res = await fetch('/api/signals/safety', { credentials: 'same-origin' });
      if (res.ok) setSafety(await res.json());
    } catch {
      /* non-blocking */
    }
  }, []);

  const fetchLinkedIn = useCallback(async (includeInmail = false) => {
    try {
      const qs = includeInmail ? '?inmail=true' : '';
      const res = await fetch(`/api/signals/linkedin${qs}`, { credentials: 'same-origin' });
      if (res.ok) setLinkedIn(await res.json());
    } catch {
      /* non-blocking */
    }
  }, []);

  const fetchIntegrations = useCallback(async (live = false) => {
    try {
      const qs = live ? '?live=true' : '';
      const res = await fetch(`/api/signals/integrations${qs}`, { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      setIntegrations((data.integrations ?? []) as IntegrationStatus[]);
    } catch {
      /* non-blocking */
    }
  }, []);

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch('/api/signals/sources', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        setSources(data.sources ?? []);
      }
    } catch {
      /* non-blocking */
    }
  }, []);

  const fetchEventsOnly = useCallback(async () => {
    setListLoading(true);
    setError(null);
    try {
      const qs = filter === 'all' ? '' : `?status=${filter}`;
      const res = await fetch(`/api/signals${qs}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Failed to load signals');
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load signals');
    } finally {
      setListLoading(false);
    }
  }, [filter]);

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = filter === 'all' ? '' : `?status=${filter}`;
      const res = await fetch(`/api/signals/bootstrap${qs}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Failed to load signals');
      const data = await res.json();
      setEvents(data.events ?? []);
      if (data.safety) setSafety(data.safety);
      if (data.sources) setSources(data.sources);
      if (data.linkedIn) setLinkedIn(data.linkedIn);
      if (data.integrations) setIntegrations(data.integrations);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load signals');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const bootstrapLoaded = useRef(false);

  useEffect(() => {
    if (!bootstrapLoaded.current) {
      bootstrapLoaded.current = true;
      void loadBootstrap();
      return;
    }
    void fetchEventsOnly();
  }, [filter, loadBootstrap, fetchEventsOnly]);

  const mergeEvent = useCallback((updated: SignalEventWithPost) => {
    setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  }, []);

  const fetchEvents = fetchEventsOnly;

  const selected = events.find((e) => e.id === selectedId) ?? events[0] ?? null;

  useEffect(() => {
    if (!selectedId && events[0]) setSelectedId(events[0].id);
  }, [events, selectedId]);

  useEffect(() => {
    if (!selected) {
      setLinkedinUrl('');
      return;
    }
    setLinkedinUrl(
      linkedInIdentifierFromSignal({
        authorHandle: selected.raw_post?.author_handle,
        personName: selected.person_name,
      }),
    );
  }, [selected?.id, selected?.raw_post?.author_handle, selected?.person_name, selected]);

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
      setSuccess('Sending is on. Draft a message, then approve when it feels right.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn on sending');
    } finally {
      setEnablingSend(false);
    }
  };

  const handleDismiss = async (id: string) => {
    const res = await fetch(`/api/signals/${id}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'dismissed' }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Could not dismiss signal');
      return;
    }
    await fetchEvents();
  };

  const handleDraft = async (id: string) => {
    setDrafting(true);
    setError(null);
    try {
      const channel = draftChannelForSend(sendChannel);
      const res = await fetch(`/api/signals/${id}/draft`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Draft failed');
      }
      const data = await res.json();
      if (data.draft?.voiceMatchScore != null) {
        setLastVoiceScore(data.draft.voiceMatchScore);
      }
      if (data.event) {
        mergeEvent(data.event as SignalEventWithPost);
      } else {
        await fetchEventsOnly();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Draft failed');
    } finally {
      setDrafting(false);
    }
  };

  const handleSend = async (id: string) => {
    if (sendChannel !== 'gmail' && !linkedinUrl.trim()) {
      setError('Enter a LinkedIn profile URL or handle.');
      return;
    }
    if (sendChannel === 'gmail' && !recipientEmail.trim()) {
      setError('Enter a recipient email for Gmail.');
      return;
    }
    if (sendChannel === 'linkedin_connect' && selected.outreach?.draft_text) {
      if (selected.outreach.draft_text.length > 300) {
        setError('LinkedIn connection notes must be 300 characters or fewer. Regenerate a shorter draft.');
        return;
      }
    }
    setSending(true);
    setError(null);
    setSuccess(null);
    try {
      const body =
        sendChannel === 'gmail'
          ? { channel: sendChannel, recipient_email: recipientEmail.trim() }
          : {
              channel: sendChannel,
              linkedin_identifier: linkedinUrl.trim(),
            };
      const res = await fetch(`/api/signals/${id}/send`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Send failed');
      setSuccess(
        sendChannel === 'gmail'
          ? 'Email sent via Gmail.'
          : sendChannel === 'linkedin_connect'
            ? 'Connection invite sent.'
            : 'LinkedIn message sent.',
      );
      if (data.event) {
        mergeEvent(data.event as SignalEventWithPost);
      } else {
        await fetchEventsOnly();
      }
      void Promise.all([fetchSafety(), fetchLinkedIn(true)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch('/api/signals/sync', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Sync failed');
      await fetchEvents();
      const result = data.result as { signalsCreated?: number; errors?: string[] } | undefined;
      if (result?.errors?.length) {
        setError(`Sync finished with issues: ${result.errors.slice(0, 3).join('; ')}`);
      } else {
        setSuccess(
          result?.signalsCreated
            ? `Found ${result.signalsCreated} new signal${result.signalsCreated === 1 ? '' : 's'}.`
            : 'You’re up to date.',
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleDemoSeed = async () => {
    setDemoSeeding(true);
    setError(null);
    try {
      const res = await fetch('/api/demo/seed', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Demo seed failed');
      await loadBootstrap();
      setSuccess(
        data.signalsCreated
          ? `Demo ready — ${data.signalsCreated} sample signal${data.signalsCreated === 1 ? '' : 's'} loaded.`
          : 'Demo profile loaded. Signals may already exist.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Demo seed failed');
    } finally {
      setDemoSeeding(false);
    }
  };

  const showDemoActions =
    process.env.NEXT_PUBLIC_DEMO_MODE === 'true' || process.env.NODE_ENV !== 'production';

  const handleSeed = async () => {
    setSeeding(true);
    setError(null);
    try {
      const res = await fetch('/api/signals/seed', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: DEMO_SEED, platform: 'x', author_handle: 'founder' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Seed failed');
      }
      await fetchEvents();
      setSuccess('Demo signal created.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Seed failed');
    } finally {
      setSeeding(false);
    }
  };

  const handleAddSource = async () => {
    if (!newSourceHandle.trim()) return;
    setError(null);
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
      setError(data.error ?? 'Could not add source');
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (data.source) {
      setSources((prev) => [...prev, data.source as SignalSourceRow]);
    }
    setNewSourceHandle('');
    setSuccess('Added to your watchlist.');
    void handleSync();
  };

  const handleScheduleFollowUp = async (id: string) => {
    setScheduling(true);
    setError(null);
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
    start.setMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    try {
      const res = await fetch(`/api/signals/${id}/calendar`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_iso: start.toISOString(),
          end_iso: end.toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Calendar create failed');
      setSuccess(data.html_link ? 'Follow-up added to Google Calendar.' : 'Follow-up scheduled.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Calendar create failed');
    } finally {
      setScheduling(false);
    }
  };

  const copyDraft = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setSuccess('Copied to clipboard.');
  };

  const canSend =
    safety?.settings.outreach_enabled &&
    !safety?.settings.dry_run &&
    (sendChannel === 'gmail'
      ? integrations.find((i) => i.toolkit === 'gmail')?.connected
      : linkedIn?.connected);

  const gmailIntegration = integrations.find((i) => i.toolkit === 'gmail');
  const calendarIntegration = integrations.find((i) => i.toolkit === 'googlecalendar');
  const needsLinkedIn = sendChannel !== 'gmail' && !linkedIn?.connected;
  const needsGmail = sendChannel === 'gmail' && !gmailIntegration?.connected;
  const sendBlocked =
    !safety?.settings.outreach_enabled ||
    safety?.settings.dry_run ||
    (Boolean(safety?.settings.working_hours_only) && !safety?.within_working_hours);

  const setupState = {
    hasSources: sources.length > 0,
    linkedInConnected: Boolean(linkedIn?.connected),
    sendingReady:
      Boolean(safety?.settings.outreach_enabled && !safety?.settings.dry_run) &&
      (!safety?.settings.working_hours_only || Boolean(safety?.within_working_hours)),
    dryRun: Boolean(safety?.settings.dry_run),
    outreachEnabled: Boolean(safety?.settings.outreach_enabled),
  };

  const settingsConnectionsHref = '/settings?tab=publishing';

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        eyebrow="Outreach"
        title="Signals"
        subtitle="When founders you follow raise or join an accelerator, draft a warm note in your voice and send."
        action={
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border border-border bg-bg-secondary hover:bg-bg-primary disabled:opacity-50"
            aria-label="Check for new signals"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Checking…' : 'Check now'}
          </button>
        }
      />

      <SignalsSetupBanner
        setup={setupState}
        enablingSend={enablingSend}
        onEnableSending={enableSending}
      />

      <details className="rounded-lg border border-border bg-bg-secondary px-4 py-3 group">
        <summary className="cursor-pointer text-xs font-medium text-text-secondary list-none flex items-center justify-between gap-2">
          <span>Who to watch ({sources.length})</span>
          <span className="text-text-tertiary group-open:hidden">Add accounts</span>
        </summary>
        <div className="mt-3 space-y-3">
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
        </div>
      </details>

      <div className="flex flex-wrap gap-2">
        {(['pending', 'drafted', 'sent', 'all'] as StatusFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors min-h-[40px] ${
              filter === f
                ? 'bg-accent-primary text-white'
                : 'bg-bg-secondary text-text-secondary hover:text-text-primary'
            }`}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

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

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 min-h-[480px]">
        <div className="lg:col-span-2 border border-border rounded-lg bg-bg-secondary overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2 text-sm font-medium text-text-secondary">
            <Radio className="h-4 w-4" />
            Inbox
            {!loading && !listLoading && <span className="text-text-tertiary">({events.length})</span>}
            {listLoading && <span className="text-text-tertiary text-xs">Updating…</span>}
          </div>
          <div className="divide-y divide-border max-h-[560px] overflow-y-auto">
            {loading && events.length === 0 && (
              <p className="p-4 text-sm text-text-tertiary">Loading signals…</p>
            )}
            {!loading && !listLoading && events.length === 0 && (
              <div className="p-8 md:p-10 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-md bg-coral-light text-accent-primary mb-5">
                  <TrendingUp className="h-7 w-7" strokeWidth={1.75} />
                </div>
                <h2 className="font-serif text-[20px] text-text-primary">No signals yet</h2>
                <p className="mt-2 text-sm text-text-secondary max-w-sm mx-auto leading-relaxed">
                  Follow founders on X or LinkedIn above. When they post about funding or
                  accelerators, they&apos;ll show up here.
                </p>
                <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
                  <button
                    type="button"
                    onClick={handleSync}
                    disabled={syncing}
                    className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-md text-sm font-medium border border-border bg-bg-primary hover:bg-bg-secondary disabled:opacity-50"
                  >
                    <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                    Check now
                  </button>
                  {!linkedIn?.connected && (
                    <Link
                      href={settingsConnectionsHref}
                      className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-md text-sm font-medium bg-accent-primary text-white hover:opacity-90"
                    >
                      Connect LinkedIn
                    </Link>
                  )}
                </div>
                {showDemoActions && (
                  <button
                    type="button"
                    onClick={handleDemoSeed}
                    disabled={demoSeeding}
                    className="mt-4 inline-flex items-center justify-center min-h-[40px] px-4 rounded-md text-sm font-medium bg-accent-primary text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {demoSeeding ? 'Loading demo…' : 'Load demo data'}
                  </button>
                )}
                {showDemoActions && (
                  <button
                    type="button"
                    onClick={handleSeed}
                    disabled={seeding}
                    className="mt-2 block mx-auto text-xs text-text-tertiary hover:text-accent-primary"
                  >
                    {seeding ? 'Adding example…' : 'Add one example signal'}
                  </button>
                )}
              </div>
            )}
            {events.map((ev) => {
              const active = selected?.id === ev.id;
              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => setSelectedId(ev.id)}
                  className={`w-full text-left px-4 py-3 hover:bg-bg-primary transition-colors ${
                    active ? 'bg-bg-primary border-l-2 border-accent-primary' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-mono uppercase tracking-wide text-accent-primary">
                      {SIGNAL_LABELS[ev.signal_type] ?? ev.signal_type}
                    </span>
                    <span className="text-xs text-text-tertiary shrink-0">
                      {formatRelative(ev.created_at)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-text-primary line-clamp-2">
                    {ev.company_name || ev.person_name || 'Unknown target'}
                    {ev.batch ? ` · ${ev.batch}` : ''}
                  </p>
                  <p className="mt-0.5 text-xs text-text-tertiary line-clamp-1">
                    {ev.signal_summary}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-3 border border-border rounded-lg bg-bg-secondary p-5 space-y-4">
          {!selected ? (
            <p className="text-sm text-text-tertiary">Select a signal to review.</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-mono uppercase tracking-wide text-text-tertiary mb-1">
                    {SIGNAL_LABELS[selected.signal_type] ?? selected.signal_type}
                    {selected.confidence
                      ? ` · ${Math.round(Number(selected.confidence) * 100)}% match`
                      : ''}
                    {' · '}
                    {STATUS_LABELS[selected.status] ?? selected.status}
                  </p>
                  <h2 className="text-xl font-display text-text-primary">
                    {selected.company_name || selected.person_name || 'Signal'}
                  </h2>
                  {selected.accelerator_name && (
                    <p className="text-sm text-text-secondary mt-1">
                      {selected.accelerator_name}
                      {selected.batch ? ` ${selected.batch}` : ''}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {selected.raw_post?.post_url && (
                    <a
                      href={selected.raw_post.post_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-accent-primary hover:underline"
                    >
                      View post <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDismiss(selected.id)}
                    className="p-1.5 rounded-md text-text-tertiary hover:bg-bg-primary hover:text-text-primary"
                    aria-label="Dismiss"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {selected.raw_post?.content && (
                <blockquote className="text-sm text-text-secondary border-l-2 border-border pl-3 py-1">
                  {selected.raw_post.content.slice(0, 500)}
                  {selected.raw_post.content.length > 500 ? '…' : ''}
                </blockquote>
              )}

              <div className="rounded-lg border border-border bg-bg-primary p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-mono uppercase tracking-wide text-text-tertiary">
                    Your draft
                  </p>
                  <button
                    type="button"
                    disabled={drafting}
                    onClick={() => handleDraft(selected.id)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md bg-accent-primary text-white disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {drafting ? 'Writing…' : selected.outreach?.draft_text ? 'Rewrite' : 'Write draft'}
                  </button>
                </div>
                {selected.outreach?.draft_text ? (
                  <>
                    <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
                      {selected.outreach.draft_text}
                    </p>
                    {lastVoiceScore != null && (
                      <p className="text-xs text-text-tertiary">
                        Voice match: {Math.round(lastVoiceScore)}/100
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => copyDraft(selected.outreach!.draft_text!)}
                      className="text-xs font-medium text-accent-primary hover:underline"
                    >
                      Copy to clipboard
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-text-tertiary">
                    We&apos;ll write a short note in your voice based on this post.
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-border bg-bg-primary p-4 space-y-3">
                <p className="text-xs font-mono uppercase tracking-wide text-text-tertiary">
                  Send
                </p>
                {(needsLinkedIn || needsGmail) && (
                  <p className="text-xs text-text-secondary">
                    {needsGmail ? (
                      <>
                        Connect email in{' '}
                        <Link href={settingsConnectionsHref} className="text-accent-primary hover:underline">
                          Settings
                        </Link>
                        .
                      </>
                    ) : (
                      <>
                        Connect LinkedIn in{' '}
                        <Link href={settingsConnectionsHref} className="text-accent-primary hover:underline">
                          Settings
                        </Link>
                        .
                      </>
                    )}
                  </p>
                )}
                {sendBlocked && !needsLinkedIn && !needsGmail && (
                  <p className="text-xs text-text-secondary">
                    Sending isn&apos;t on yet.{' '}
                    <button
                      type="button"
                      onClick={enableSending}
                      disabled={enablingSend}
                      className="text-accent-primary hover:underline disabled:opacity-50"
                    >
                      Turn on sending
                    </button>
                  </p>
                )}
                <div className="flex flex-wrap gap-3">
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="channel"
                      checked={sendChannel === 'linkedin_connect'}
                      onChange={() => setSendChannel('linkedin_connect')}
                    />
                    LinkedIn request
                  </label>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="channel"
                      checked={sendChannel === 'linkedin_dm'}
                      onChange={() => setSendChannel('linkedin_dm')}
                    />
                    LinkedIn message
                  </label>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="channel"
                      checked={sendChannel === 'gmail'}
                      onChange={() => setSendChannel('gmail')}
                    />
                    Email
                  </label>
                </div>
                {sendChannel === 'gmail' ? (
                  <input
                    type="email"
                    placeholder="founder@company.com"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    className="w-full text-sm rounded-md border border-border bg-bg-secondary px-3 py-2 min-h-[44px]"
                  />
                ) : (
                  <input
                    type="text"
                    placeholder="LinkedIn profile (we pre-fill when we can)"
                    value={linkedinUrl}
                    onChange={(e) => setLinkedinUrl(e.target.value)}
                    className="w-full text-sm rounded-md border border-border bg-bg-secondary px-3 py-2 min-h-[44px]"
                  />
                )}
                <button
                  type="button"
                  disabled={sending || !canSend || !selected.outreach?.draft_text || sendBlocked}
                  onClick={() => handleSend(selected.id)}
                  className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2.5 rounded-md bg-accent-primary text-white disabled:opacity-50 min-h-[44px]"
                >
                  <Send className="h-4 w-4" />
                  {sending ? 'Sending…' : 'Send'}
                </button>
                {selected.outreach?.status === 'sent' && (
                  <p className="text-xs text-green-700">Sent via {selected.outreach.channel}.</p>
                )}
                {selected.outreach?.status === 'failed' && selected.outreach.error && (
                  <p className="text-xs text-red-600">{selected.outreach.error}</p>
                )}
              </div>

              {calendarIntegration?.connected && (
                <div className="rounded-lg border border-border bg-bg-primary p-4 space-y-2">
                  <p className="text-xs font-mono uppercase tracking-wide text-text-tertiary">
                    Follow-up
                  </p>
                  <button
                    type="button"
                    disabled={scheduling}
                    onClick={() => handleScheduleFollowUp(selected.id)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border border-border bg-bg-secondary hover:bg-bg-primary disabled:opacity-50"
                  >
                    {scheduling ? 'Adding…' : 'Add to calendar'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
