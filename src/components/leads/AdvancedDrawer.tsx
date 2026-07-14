'use client';

import { useEffect, useState } from 'react';
import { X, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import type { DirectorySettingsRow, FollowedCompanyRow } from '@/lib/signals/types';
import { LEAD_SOURCE_UI } from '@/lib/signals/leads/directory-defaults';
import { normalizeMeetingLink } from '@/lib/signals/leads/meeting-link';

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

/** Splits a comma-separated input into a trimmed, empties-removed string list. */
function split(v: string): string[] {
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

interface AdvancedDrawerProps {
  open: boolean;
  onClose: () => void;
  settings: DirectorySettingsRow | null;
  followed: FollowedCompanyRow[];
  onSettingsSaved: (s: DirectorySettingsRow) => void;
  onFollowedChange: (f: FollowedCompanyRow[]) => void;
  onDiscoveryComplete?: () => void;
  toast: (m: string, t?: 'success' | 'error') => void;
}

/**
 * GTM setup drawer: describe ICP in natural language (BigSet-style intake),
 * tune structured filters, enable lead sources, and manage the watchlist.
 */
export function AdvancedDrawer({
  open,
  onClose,
  settings,
  followed,
  onSettingsSaved,
  onFollowedChange,
  onDiscoveryComplete,
  toast,
}: AdvancedDrawerProps) {
  const [icpDescription, setIcpDescription] = useState('');
  const [verticals, setVerticals] = useState('');
  const [keywords, setKeywords] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [company, setCompany] = useState('');
  const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(false);

  useEffect(() => {
    if (settings) {
      setIcpDescription(settings.icp_description ?? '');
      setVerticals((settings.icp_verticals ?? []).join(', '));
      setKeywords((settings.icp_keywords ?? []).join(', '));
      setMeetingLink(settings.meeting_link ?? '');
    }
  }, [settings]);

  const applyIcp = async () => {
    if (icpDescription.trim().length < 10) {
      toast('Describe your ICP in at least one sentence.', 'error');
      return;
    }
    setDiscovering(true);
    try {
      const res = await fetch('/api/leads/icp', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ description: icpDescription.trim(), discover: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'ICP apply failed');
      onSettingsSaved(data.settings);
      const inserted = data.sync?.inserted ?? 0;
      toast(inserted > 0 ? `ICP applied - ${inserted} new leads found.` : 'ICP applied - discovery running.');
      onDiscoveryComplete?.();
    } catch (err) {
      console.error('ICP apply failed', err);
      toast('Could not apply ICP.', 'error');
    } finally {
      setDiscovering(false);
    }
  };

  const apply = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/leads/settings', {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({
          icp_description: icpDescription.trim() || null,
          icp_verticals: split(verticals),
          icp_keywords: split(keywords),
        }),
      });
      const data = await res.json();
      onSettingsSaved(data.settings);
      toast('Filters applied.');
    } catch (err) {
      console.error('Failed to save ICP filters', err);
      toast('Could not save.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const follow = async () => {
    if (!company.trim()) return;
    const res = await fetch('/api/leads/followed', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ companyName: company.trim() }) });
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
        <h2 className="text-lg font-display text-text-primary">GTM setup</h2>
        <button onClick={onClose} aria-label="Close GTM setup drawer" className="p-1 text-text-tertiary hover:text-text-primary cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary rounded"><X className="h-5 w-5" /></button>
      </div>

      <section className="space-y-3 mb-6">
        <p className="text-xs tracking-wide text-text-tertiary">Describe your ICP</p>
        <p className="text-xs text-text-tertiary">
          Tell us who you sell to in plain English. We search the open web for matching companies, score them against your ICP, and surface them in your feed.
        </p>
        <textarea
          value={icpDescription}
          onChange={(e) => setIcpDescription(e.target.value)}
          rows={4}
          placeholder="Seed-stage fintech startups from YC W25 that need modern treasury and banking..."
          className="w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
        />
        <Button variant="primary" size="sm" onClick={applyIcp} loading={discovering}>
          <Sparkles className="h-4 w-4" /> Find leads for this ICP
        </Button>
      </section>

      <section className="space-y-3 mb-6">
        <p className="text-xs tracking-wide text-text-tertiary">Structured filters</p>
        <label className="block text-sm text-text-secondary">
          ICP verticals
          <input value={verticals} onChange={(e) => setVerticals(e.target.value)} placeholder="Fintech, AI, SaaS" className="mt-1 w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary" />
        </label>
        <label className="block text-sm text-text-secondary">
          ICP keywords
          <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="compliance, analytics" className="mt-1 w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary" />
        </label>
        <p className="text-xs text-text-tertiary">Leads matching these rank higher. Auto-filled when you describe your ICP above.</p>
        <Button variant="secondary" size="sm" onClick={apply} loading={saving}>Save filters only</Button>
      </section>

      <section className="space-y-2 mb-6">
        <p className="text-xs tracking-wide text-text-tertiary">Meeting link</p>
        <p className="text-xs text-text-tertiary">
          Paste Calendly / Google Calendar / Cal.com - included in reply drafts when booking a call.
        </p>
        <input
          value={meetingLink}
          onChange={(e) => setMeetingLink(e.target.value)}
          placeholder="https://calendly.com/you/15min"
          className="w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
        />
        {meetingLink.trim() && (
          <p className={`text-xs ${normalizeMeetingLink(meetingLink) ? 'text-accent-secondary' : 'text-red-600'}`}>
            {normalizeMeetingLink(meetingLink)
              ? `Ready: ${normalizeMeetingLink(meetingLink)!.label}`
              : 'Invalid URL'}
          </p>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            const res = await fetch('/api/leads/settings', {
              method: 'PUT',
              headers: jsonHeaders,
              body: JSON.stringify({ meeting_link: meetingLink.trim() || null }),
            });
            const data = await res.json();
            if (!res.ok) {
              toast(data.error ?? 'Could not save meeting link.', 'error');
              return;
            }
            onSettingsSaved(data.settings);
            toast('Meeting link saved.');
          }}
        >
          Save meeting link
        </Button>
      </section>

      <section className="space-y-2 mb-6">
        <p className="text-xs tracking-wide text-text-tertiary">Lead sources</p>
        <p className="text-xs text-text-tertiary">Optional add-ons. Web discovery runs from your ICP description above.</p>
        {LEAD_SOURCE_UI.map((s) => {
          const disabled = s.disabled?.() ?? false;
          const on = (settings?.enabled_sources ?? []).includes(s.key);
          return (
            <label key={s.key} className={`flex items-start gap-2 text-sm ${disabled ? 'text-text-tertiary' : 'text-text-secondary'}`}>
              <input
                type="checkbox"
                checked={on}
                disabled={disabled}
                onChange={async (e) => {
                  if (disabled) return;
                  const next = e.target.checked
                    ? [...(settings?.enabled_sources ?? []), s.key]
                    : (settings?.enabled_sources ?? []).filter((x) => x !== s.key);
                  const res = await fetch('/api/leads/settings', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ enabled_sources: next }) });
                  const data = await res.json();
                  onSettingsSaved(data.settings);
                }}
                className="mt-0.5"
              />
              <span>
                {s.label}
                {s.hint ? <span className="block text-xs text-text-tertiary">{s.hint}</span> : null}
              </span>
            </label>
          );
        })}
      </section>

      <section className="space-y-3">
        <p className="text-xs tracking-wide text-text-tertiary">Watch companies</p>
        <p className="text-xs text-text-tertiary">Follow companies to resurface them when they raise, hire, or launch.</p>
        <div className="flex gap-2">
          <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company name or domain" className="flex-1 rounded-md border border-border bg-bg-primary px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary" />
          <Button variant="primary" size="sm" onClick={follow}>Watch</Button>
        </div>
        {followed.length === 0 ? (
          <p className="text-xs text-text-tertiary">No companies on your watchlist yet.</p>
        ) : (
          <ul className="space-y-1">
            {followed.map((f) => (
              <li key={f.id} className="flex items-center justify-between text-sm text-text-secondary border border-border rounded-md px-3 py-1.5">
                <span>{f.company_name}{f.domain ? ` · ${f.domain}` : ''}</span>
                <button onClick={() => unfollow(f.id)} aria-label={`Stop watching ${f.company_name}`} className="text-text-tertiary hover:text-red-600 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary rounded"><X className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Drawer>
  );
}
