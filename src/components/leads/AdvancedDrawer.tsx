'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import type { DirectorySettingsRow, FollowedCompanyRow } from '@/lib/signals/types';

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
  toast: (m: string, t?: 'success' | 'error') => void;
}

/**
 * The Advanced side drawer: ICP verticals/keywords tuning, per-source toggles,
 * and the followed-companies watchlist (add/remove). Extracted from the leads
 * page unchanged so the unified feed keeps the same settings surface. All writes
 * go through the existing `/api/leads/settings` and `/api/leads/followed`
 * endpoints and lift state back up via the callbacks.
 */
export function AdvancedDrawer({
  open,
  onClose,
  settings,
  followed,
  onSettingsSaved,
  onFollowedChange,
  toast,
}: AdvancedDrawerProps) {
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
        headers: jsonHeaders,
        body: JSON.stringify({ icp_verticals: split(verticals), icp_keywords: split(keywords) }),
      });
      const data = await res.json();
      onSettingsSaved(data.settings);
      toast('Filters applied.');
    } catch (err) {
      // Surface the failure instead of silently swallowing it.
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
        <h2 className="text-lg font-display text-text-primary">Advanced</h2>
        <button onClick={onClose} aria-label="Close advanced drawer" className="p-1 text-text-tertiary hover:text-text-primary cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary rounded"><X className="h-5 w-5" /></button>
      </div>

      <section className="space-y-3 mb-6">
        <p className="text-xs font-mono uppercase tracking-wide text-text-tertiary">Filters</p>
        <label className="block text-sm text-text-secondary">
          ICP verticals
          <input value={verticals} onChange={(e) => setVerticals(e.target.value)} placeholder="Fintech, AI, SaaS" className="mt-1 w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary" />
        </label>
        <label className="block text-sm text-text-secondary">
          ICP keywords
          <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="compliance, analytics" className="mt-1 w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary" />
        </label>
        <p className="text-xs text-text-tertiary">Leads matching these rank higher. Leave blank to see everything.</p>
        <Button variant="primary" size="sm" onClick={apply} loading={saving}>Apply</Button>
      </section>

      <section className="space-y-2 mb-6">
        <p className="text-xs font-mono uppercase tracking-wide text-text-tertiary">Sources</p>
        {([
          { key: 'yc_directory', label: 'YC directory' },
          { key: 'product_hunt', label: 'Product Hunt' },
        ] as const).map((s) => {
          const on = (settings?.enabled_sources ?? []).includes(s.key);
          return (
            <label key={s.key} className="flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={on}
                onChange={async (e) => {
                  const next = e.target.checked
                    ? [...(settings?.enabled_sources ?? []), s.key]
                    : (settings?.enabled_sources ?? []).filter((x) => x !== s.key);
                  const res = await fetch('/api/leads/settings', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ enabled_sources: next }) });
                  const data = await res.json();
                  onSettingsSaved(data.settings);
                }}
              />
              {s.label}
            </label>
          );
        })}
      </section>

      <section className="space-y-3">
        <p className="text-xs font-mono uppercase tracking-wide text-text-tertiary">Follow companies</p>
        <div className="flex gap-2">
          <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company name or domain" className="flex-1 rounded-md border border-border bg-bg-primary px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary" />
          <Button variant="primary" size="sm" onClick={follow}>Follow</Button>
        </div>
        {followed.length === 0 ? (
          <p className="text-xs text-text-tertiary">Follow specific companies to always track them for funding/hiring signals.</p>
        ) : (
          <ul className="space-y-1">
            {followed.map((f) => (
              <li key={f.id} className="flex items-center justify-between text-sm text-text-secondary border border-border rounded-md px-3 py-1.5">
                <span>{f.company_name}{f.domain ? ` · ${f.domain}` : ''}</span>
                <button onClick={() => unfollow(f.id)} aria-label={`Unfollow ${f.company_name}`} className="text-text-tertiary hover:text-red-600 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary rounded"><X className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-text-tertiary">Followed companies resurface automatically when something changes.</p>
      </section>
    </Drawer>
  );
}
