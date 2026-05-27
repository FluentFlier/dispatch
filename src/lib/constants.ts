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

export const PLATFORMS = ['instagram', 'linkedin', 'twitter', 'threads'] as const;
export type Platform = typeof PLATFORMS[number];

export const PRIORITIES = ['low', 'medium', 'high'] as const;
export type Priority = typeof PRIORITIES[number];

export const NAV_ITEMS = [
  { label: 'Dashboard', href: '/dashboard', icon: 'home' },
  { label: 'Generate', href: '/generate', icon: 'wand' },
  { label: 'Library', href: '/library', icon: 'grid' },
  { label: 'Calendar', href: '/calendar', icon: 'calendar' },
  { label: 'Story Bank', href: '/story-bank', icon: 'archive' },
  { label: 'Ideas', href: '/ideas', icon: 'lightbulb' },
  { label: 'Series', href: '/series', icon: 'layers' },
  { label: 'Analytics', href: '/analytics', icon: 'bar-chart' },
  { label: 'Settings', href: '/settings', icon: 'gear' },
] as const;
