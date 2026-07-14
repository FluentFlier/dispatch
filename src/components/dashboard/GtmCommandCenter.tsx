'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Linkedin, MessageSquare, Radio, Sparkles, Target } from 'lucide-react';
import { IcpChat } from '@/components/leads/IcpChat';
import { useToast } from '@/components/ui/Toast';
import type { EngagementTaskRow } from '@/lib/engagement/tasks';
import type { SafetyStatusSnapshot } from '@/lib/signals/safety/guard';
import type { DirectorySettingsRow } from '@/lib/signals/types';

interface GtmTodayData {
  safety: SafetyStatusSnapshot;
  icpConfigured: boolean;
  pipeline: {
    discovered: number;
    engaging: number;
    connectReady: number;
    connectSent: number;
    dmReady: number;
    sentToday: number;
  };
  connectsDue: Array<{
    id: string;
    company_name: string;
    rank_score: number;
    next_action_at: string | null;
  }>;
  dmsDue: Array<{
    id: string;
    company_name: string;
    rank_score: number;
    next_action_at: string | null;
  }>;
  commentDrafts: EngagementTaskRow[];
}

function LimitBar({
  label,
  used,
  max,
}: {
  label: string;
  used: number;
  max: number;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const hot = pct >= 85;
  return (
    <div className="rounded-2xl border border-hair bg-white/80 p-3 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-ink2">{label}</span>
        <span className={`tabular-nums ${hot ? 'text-flame' : 'text-ink'}`}>
          {used}/{max}
        </span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-paper2 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${hot ? 'bg-flame' : 'bg-blue'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * GTM command center - ICP pipeline, LinkedIn limits, and today's outreach queue.
 */
export function GtmCommandCenter() {
  const { toast } = useToast();
  const [data, setData] = useState<GtmTodayData | null>(null);
  const [settings, setSettings] = useState<DirectorySettingsRow | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/leads/bootstrap');
      if (res.ok) {
        const boot = await res.json();
        setSettings(boot.settings ?? null);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/gtm/today');
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshGtm = useCallback(() => {
    void load();
    void loadSettings();
  }, [load, loadSettings]);

  useEffect(() => {
    void load();
    void loadSettings();
  }, [load, loadSettings]);

  if (loading) {
    return (
      <section className="card-surface p-5">
        <p className="text-sm text-ink2">Loading GTM pipeline…</p>
      </section>
    );
  }

  if (!data) return null;

  const { safety, pipeline, connectsDue, dmsDue, commentDrafts, icpConfigured } = data;
  const sendingLive =
    safety.settings.outreach_enabled && !safety.settings.dry_run;
  const autoOn = safety.settings.auto_send_enabled && sendingLive;

  return (
    <section className="card-surface overflow-hidden">
      <div className="p-5 md:p-6 border-b border-hair">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-hair bg-white/80 px-3 py-1 text-[11px] font-medium tracking-[0.01em] text-ink2">
              <Target className="h-3 w-3" />
              GTM pipeline
            </span>
            <h2 className="mt-3 text-lg font-semibold text-ink tracking-tight">
              Today&apos;s outreach
            </h2>
            <p className="mt-1 text-sm text-ink2 max-w-xl">
              {icpConfigured
                ? 'ICP leads surface daily. Plan nurture → comment → connect on autopilot or approve each step.'
                : 'Use the ICP assistant below to describe who you sell to - then ask it to find leads.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                sendingLive
                  ? 'border border-lime/25 bg-lime/15 text-ink'
                  : 'border border-hair bg-paper2 text-ink3'
              }`}
            >
              <Radio className="h-3 w-3" />
              {sendingLive ? 'Sending on' : 'Dry run / off'}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                autoOn
                  ? 'border border-blue/20 bg-blue/10 text-blue'
                  : 'border border-hair bg-paper2 text-ink3'
              }`}
            >
              <Linkedin className="h-3 w-3" />
              {autoOn ? 'Auto-connect on' : 'Manual approve'}
            </span>
          </div>
        </div>

        {!icpConfigured && (
          <div className="mt-5">
            <IcpChat
              settings={settings}
              onSettingsSaved={setSettings}
              onDiscoveryComplete={refreshGtm}
              toast={toast}
            />
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="rounded-2xl border border-hair bg-paper2/60 p-3">
            <p className="text-xs text-ink2">New / planned</p>
            <p className="text-2xl font-semibold text-ink tabular-nums">{pipeline.discovered}</p>
          </div>
          <div className="rounded-2xl border border-hair bg-paper2/60 p-3">
            <p className="text-xs text-ink2">Commenting</p>
            <p className="text-2xl font-semibold text-ink tabular-nums">{pipeline.engaging}</p>
          </div>
          <div className="rounded-2xl border border-hair bg-paper2/60 p-3">
            <p className="text-xs text-ink2">Connect queued</p>
            <p className="text-2xl font-semibold text-ink tabular-nums">{pipeline.connectReady}</p>
          </div>
          <div className="rounded-2xl border border-hair bg-paper2/60 p-3">
            <p className="text-xs text-ink2">Connect sent</p>
            <p className="text-2xl font-semibold text-ink tabular-nums">{pipeline.connectSent}</p>
          </div>
          <div className="rounded-2xl border border-hair bg-paper2/60 p-3">
            <p className="text-xs text-ink2">DM ready</p>
            <p className="text-2xl font-semibold text-lilac tabular-nums">{pipeline.dmReady}</p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-hair bg-paper2/60 p-3 sm:col-span-1">
            <p className="text-xs text-ink2">Sent today</p>
            <p className="text-2xl font-semibold text-flame tabular-nums">{pipeline.sentToday}</p>
          </div>
          <LimitBar
            label="LinkedIn invites today"
            used={safety.usage.linkedin_invites_today}
            max={safety.settings.max_linkedin_invites_per_day}
          />
          <LimitBar
            label="LinkedIn invites this week"
            used={safety.usage.linkedin_invites_this_week}
            max={safety.settings.max_linkedin_invites_per_week}
          />
        </div>
      </div>

      {icpConfigured && (
        <div className="p-5 md:p-6 border-b border-hair bg-paper2/30">
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2 mb-3">
            <MessageSquare className="h-4 w-4 text-blue" />
            ICP assistant
          </h3>
          <IcpChat
            compact
            settings={settings}
            onSettingsSaved={setSettings}
            onDiscoveryComplete={refreshGtm}
            toast={toast}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-hair">
        <div className="p-5 md:p-6">
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
            <Linkedin className="h-4 w-4 text-blue" />
            Connects due
          </h3>
          {connectsDue.length === 0 ? (
            <p className="mt-2 text-sm text-ink2">
              No connects queued right now. Plan nurture on a lead or enable auto-send in Setup.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {connectsDue.map((l) => (
                <li key={l.id}>
                  <Link
                    href={`/leads?lead=${l.id}`}
                    className="flex items-center justify-between rounded-xl border border-hair bg-white/70 px-3 py-2 text-sm hover:border-blue/30 transition-colors"
                  >
                    <span className="font-medium text-ink truncate">{l.company_name}</span>
                    <ArrowRight className="h-4 w-4 text-ink3 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-5 md:p-6">
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-lilac" />
            DMs due
          </h3>
          {dmsDue.length === 0 ? (
            <p className="mt-2 text-sm text-ink2">No follow-up DMs queued yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {dmsDue.map((l) => (
                <li key={l.id}>
                  <Link
                    href={`/leads?lead=${l.id}`}
                    className="flex items-center justify-between rounded-xl border border-hair bg-white/70 px-3 py-2 text-sm hover:border-lilac/30 transition-colors"
                  >
                    <span className="font-medium text-ink truncate">{l.company_name}</span>
                    <ArrowRight className="h-4 w-4 text-ink3 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-5 md:p-6">
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-lilac" />
            Comments to approve
          </h3>
          {commentDrafts.length === 0 ? (
            <p className="mt-2 text-sm text-ink2">No comment drafts waiting.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {commentDrafts.map((t) => (
                <li
                  key={t.id}
                  className="rounded-xl border border-hair bg-white/70 px-3 py-2 text-xs text-ink2 line-clamp-2"
                >
                  {t.target_author_name ? `${t.target_author_name}: ` : ''}
                  {t.comment_text ?? t.target_post_excerpt}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="px-5 md:px-6 py-4 bg-paper2/40 border-t border-hair flex flex-wrap gap-3">
        <Link href="/leads" className="btn-primary min-h-[40px]">
          Open leads feed
        </Link>
        <Link href="/leads?view=setup" className="btn-secondary min-h-[40px]">
          Full GTM setup &amp; sources
        </Link>
      </div>
    </section>
  );
}
