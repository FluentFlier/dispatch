'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import type { DirectorySettingsRow, FollowedCompanyRow } from '@/lib/signals/types';

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

/**
 * Every source a scrape can actually use, matching ALL_CONFIGURABLE_SOURCES in
 * lib/signals/leads/directory-defaults.ts. This card used to list only the three
 * directories, so a workspace whose enabled_sources already included
 * web_discovery / linkedin / x had no way to see or change them - and the ICP
 * assistant would truthfully say "I'll search the open web, X and LinkedIn"
 * while the UI showed three checkboxes that said otherwise.
 *
 * Deliberately NOT using LEAD_SOURCE_UI's `disabled()` predicates: those read
 * server-only env vars (APIFY_TOKEN, TINYFISH_API_KEY) which are undefined in
 * the browser bundle, so every social source would render permanently disabled.
 * The checkbox state comes from settings.enabled_sources instead, which the
 * server already computed through mergeEnabledSources() with real env access.
 */
const SOURCES = [
  { key: 'web_discovery', label: 'Web discovery', hint: 'Open-web search driven by your ICP' },
  { key: 'yc_directory', label: 'YC directory' },
  { key: 'yc_launches', label: 'YC launches' },
  { key: 'product_hunt', label: 'Product Hunt', hint: 'Newest launches matching your ICP' },
  { key: 'linkedin', label: 'LinkedIn discovery', hint: 'LinkedIn company search + your ICP' },
  { key: 'x', label: 'X discovery', hint: 'X search + your ICP' },
] as const;

interface LeadSourcesCardProps {
  settings: DirectorySettingsRow | null;
  followed: FollowedCompanyRow[];
  onSettingsSaved: (s: DirectorySettingsRow) => void;
  onFollowedChange: (f: FollowedCompanyRow[]) => void;
  toast: (m: string, t?: 'success' | 'error') => void;
}

/**
 * "Where to look" - the lead-source toggles and company watchlist. Folded in
 * from the retired Advanced drawer so all lead configuration lives on one Setup
 * surface. ICP description now has a single home (the ICP chat above), so the
 * drawer's duplicate ICP inputs are gone.
 */
export function LeadSourcesCard({
  settings,
  followed,
  onSettingsSaved,
  onFollowedChange,
  toast,
}: LeadSourcesCardProps) {
  const [company, setCompany] = useState('');

  const toggleSource = async (key: string, on: boolean) => {
    const next = on
      ? [...(settings?.enabled_sources ?? []), key]
      : (settings?.enabled_sources ?? []).filter((x) => x !== key);
    try {
      const res = await fetchWithAuth('/api/leads/settings', {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ enabled_sources: next }),
      });
      const data = await res.json().catch(() => ({}));
      // Guard: a failed save returns no settings - applying it wiped the parent
      // settings to undefined (which blanks the whole Setup surface).
      if (!res.ok || !data.settings) {
        toast('Could not update sources.', 'error');
        return;
      }
      onSettingsSaved(data.settings);
    } catch {
      toast('Could not update sources.', 'error');
    }
  };

  const follow = async () => {
    if (!company.trim()) return;
    try {
      const res = await fetchWithAuth('/api/leads/followed', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ companyName: company.trim() }),
      });
      const data = await res.json();
      if (data.duplicate) return toast('Already following.', 'error');
      onFollowedChange(data.followedCompanies ?? followed);
      setCompany('');
      toast(`Following ${company.trim()}.`);
    } catch {
      toast('Could not follow.', 'error');
    }
  };

  const unfollow = async (id: string) => {
    try {
      const res = await fetchWithAuth(`/api/leads/followed/${id}`, { method: 'DELETE' });
      const data = await res.json();
      onFollowedChange(data.followedCompanies ?? followed);
      toast('Unfollowed.');
    } catch {
      toast('Could not unfollow.', 'error');
    }
  };

  return (
    <section className="rounded-lg border border-border bg-bg-secondary">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-text-primary">Where to look</h2>
        <p className="mt-0.5 text-xs text-text-secondary">
          Pick which directories we scan, and follow specific companies to resurface when they raise, hire, or launch.
        </p>
      </div>

      <div className="space-y-5 px-4 py-4">
        <div className="space-y-2">
          <p className="text-xs font-medium text-text-secondary">Lead sources</p>
          {SOURCES.map((s) => {
            const on = (settings?.enabled_sources ?? []).includes(s.key);
            return (
              <label key={s.key} className="flex items-start gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => void toggleSource(s.key, e.target.checked)}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  {s.label}
                  {'hint' in s && s.hint && (
                    <span className="block text-xs text-text-tertiary">{s.hint}</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-text-secondary">Watch companies</p>
          <div className="flex gap-2">
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void follow();
              }}
              placeholder="Company name or domain"
              className="flex-1 rounded-md border border-border bg-bg-primary px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
            />
            <Button variant="primary" size="sm" onClick={() => void follow()}>Watch</Button>
          </div>
          {followed.length === 0 ? (
            <p className="text-xs text-text-tertiary">No companies on your watchlist yet.</p>
          ) : (
            <ul className="space-y-1">
              {followed.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary"
                >
                  <span>{f.company_name}{f.domain ? ` · ${f.domain}` : ''}</span>
                  <button
                    onClick={() => void unfollow(f.id)}
                    aria-label={`Stop watching ${f.company_name}`}
                    className="rounded text-text-tertiary hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
