import { navItems } from '@/lib/nav-config';

/** A statically-known destination the command palette can jump to. */
export interface SearchEntry {
  /** What the user sees as the result title. */
  label: string;
  /** Breadcrumb of where it lives, e.g. "Settings › Connections". */
  crumb: string;
  href: string;
  group: 'Page' | 'Settings';
  /** Extra terms to match on beyond the label (synonyms, sub-items). */
  keywords?: string[];
}

// Settings sub-sections. Sub-headers can't scroll-anchor (no ids on the page),
// so each deep-links to its tab; the breadcrumb tells the user where it is.
// Keep in sync with the tabs/sub-headers in app/(dashboard)/settings/page.tsx.
const SETTINGS_ENTRIES: SearchEntry[] = [
  {
    label: 'Connections',
    crumb: 'Settings › Connections',
    href: '/settings?tab=connections',
    group: 'Settings',
    keywords: ['accounts', 'integrations', 'connect', 'linkedin', 'twitter', 'x', 'social'],
  },
  { label: 'Social media accounts', crumb: 'Settings › Connections › Social Media', href: '/settings?tab=connections', group: 'Settings', keywords: ['linkedin', 'twitter', 'x', 'unipile'] },
  { label: 'Email (Gmail)', crumb: 'Settings › Connections › Email', href: '/settings?tab=connections', group: 'Settings', keywords: ['gmail', 'mail', 'composio'] },
  { label: 'Slack', crumb: 'Settings › Connections › Slack', href: '/settings?tab=connections', group: 'Settings' },
  { label: 'Calendar', crumb: 'Settings › Connections › Calendar', href: '/settings?tab=connections', group: 'Settings', keywords: ['google calendar', 'events'] },
  { label: 'Knowledge (Notion)', crumb: 'Settings › Connections › Knowledge', href: '/settings?tab=connections', group: 'Settings', keywords: ['notion', 'docs'] },
  { label: 'Platform defaults', crumb: 'Settings › Connections › Platform Defaults', href: '/settings?tab=connections', group: 'Settings', keywords: ['default platform', 'cross-post'] },
  { label: 'Billing', crumb: 'Settings › Billing', href: '/settings?tab=billing', group: 'Settings', keywords: ['plan', 'subscription', 'upgrade', 'invoice', 'payment'] },
  { label: 'Profile', crumb: 'Settings › Profile', href: '/settings?tab=profile', group: 'Settings', keywords: ['display name', 'bio', 'about you'] },
  { label: 'Personal context', crumb: 'Settings › Profile › Personal Context', href: '/settings?tab=profile', group: 'Settings', keywords: ['context', 'facts'] },
  { label: 'Voice', crumb: 'Settings › Content › Voice', href: '/settings?tab=content', group: 'Settings', keywords: ['tone', 'writing style'] },
  { label: 'Pillar weights', crumb: 'Settings › Content › Pillar Weights', href: '/settings?tab=content', group: 'Settings', keywords: ['pillars', 'topics'] },
  { label: 'Weekly schedule', crumb: 'Settings › Content › Weekly Schedule', href: '/settings?tab=content', group: 'Settings', keywords: ['cadence', 'posting days'] },
  { label: 'Auto-optimize', crumb: 'Settings › Content › Auto-Optimize', href: '/settings?tab=content', group: 'Settings' },
  { label: 'Agent access', crumb: 'Settings › Tools › Agent Access', href: '/settings?tab=tools', group: 'Settings', keywords: ['api', 'token'] },
  { label: 'Hook mining watchlist', crumb: 'Settings › Tools › Hook Watchlist', href: '/settings?tab=tools', group: 'Settings', keywords: ['hooks'] },
  { label: 'Profile bio generator', crumb: 'Settings › Tools › Bio Generator', href: '/settings?tab=tools', group: 'Settings', keywords: ['bio'] },
];

// Nav pages, derived from the single nav source of truth (skips hidden routes).
const PAGE_ENTRIES: SearchEntry[] = navItems
  .filter((i) => !i.hidden)
  .map((i) => ({ label: i.name, crumb: i.name, href: i.href, group: 'Page' as const }));

export const STATIC_ENTRIES: SearchEntry[] = [...PAGE_ENTRIES, ...SETTINGS_ENTRIES];

/** Substring search over label + crumb + keywords. Prefix/label hits rank first. */
export function searchStatic(query: string, limit = 8): SearchEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { e: SearchEntry; score: number }[] = [];
  for (const e of STATIC_ENTRIES) {
    const label = e.label.toLowerCase();
    const hay = `${label} ${e.crumb.toLowerCase()} ${(e.keywords ?? []).join(' ').toLowerCase()}`;
    if (!hay.includes(q)) continue;
    let score = 0;
    if (label.startsWith(q)) score = 3;
    else if (label.includes(q)) score = 2;
    else score = 1;
    scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score || a.e.label.length - b.e.label.length);
  return scored.slice(0, limit).map((s) => s.e);
}
