export const PILLARS = [
  'hot-take',
  'hackathon',
  'founder',
  'explainer',
  'origin',
  'research',
] as const;

export type Pillar = typeof PILLARS[number];

export const PILLAR_LABELS: Record<Pillar, string> = {
  'hot-take': 'Hot Take',
  hackathon: 'Hackathon',
  founder: 'Founder',
  explainer: 'Explainer',
  origin: 'Origin',
  research: 'Research',
};

export const PILLAR_COLORS: Record<Pillar, string> = {
  'hot-take': '#DC6B5C',
  hackathon: '#D4A054',
  founder: '#E07A5F',
  explainer: '#8B7BB8',
  origin: '#3D8B7A',
  research: '#5B8FA8',
};

export const PILLAR_BADGE_BG: Record<Pillar, string> = {
  'hot-take': 'bg-red-50 text-red-800',
  hackathon: 'bg-amber-50 text-amber-800',
  founder: 'bg-coral-light text-accent-primary',
  explainer: 'bg-purple-50 text-purple-800',
  origin: 'bg-sage-light text-accent-secondary',
  research: 'bg-sky-50 text-sky-800',
};

export const STATUSES = ['idea', 'scripted', 'filmed', 'edited', 'posted'] as const;
export type Status = typeof STATUSES[number];

export const STATUS_LABELS: Record<Status, string> = {
  idea: 'Idea',
  scripted: 'Scripted',
  filmed: 'Filmed',
  edited: 'Edited',
  posted: 'Posted',
};

export const STATUS_BADGE: Record<Status, string> = {
  idea: 'bg-bg-tertiary text-text-tertiary',
  scripted: 'bg-coral-light text-accent-primary',
  filmed: 'bg-amber-100 text-amber-800',
  edited: 'bg-orange-100 text-orange-800',
  posted: 'bg-sage-light text-accent-secondary',
};

export const ALL_PLATFORMS = ['instagram', 'linkedin', 'twitter', 'threads'] as const;
export type Platform = typeof ALL_PLATFORMS[number];

/** Platforms shown in dashboard UI - X and LinkedIn only. */
export const DASHBOARD_PLATFORMS = ['twitter', 'linkedin'] as const;
export type DashboardPlatform = typeof DASHBOARD_PLATFORMS[number];

/** Alias used by dashboard components for platform pickers. */
export const PLATFORMS = DASHBOARD_PLATFORMS;

export const PLATFORM_LABELS: Record<Platform, string> = {
  twitter: 'X',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  threads: 'Threads',
};

export function isDashboardPlatform(value: string): value is DashboardPlatform {
  return value === 'twitter' || value === 'linkedin';
}

export function normalizeDashboardPlatform(value: string | null | undefined): DashboardPlatform {
  const normalized = value ?? '';
  return isDashboardPlatform(normalized) ? normalized : 'linkedin';
}

export const PRIORITIES = ['low', 'medium', 'high'] as const;
export type Priority = typeof PRIORITIES[number];
