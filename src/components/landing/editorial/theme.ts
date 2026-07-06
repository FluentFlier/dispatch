/**
 * Landing visual theme: Silk Signal
 * Soft paper, ink type, blue signal + teal publish + flame draft accents.
 */

export const LAND_THEME = {
  name: 'Silk Signal',
  paper: '#FBFAF7',
  ink: '#171717',
  signal: '#2563EB',
  draft: '#E8543A',
  publish: '#0F766E',
} as const;

export type SectionKey =
  | 'problem'
  | 'loop'
  | 'distribution'
  | 'voice'
  | 'different'
  | 'week'
  | 'who';

export interface SectionTheme {
  tag: string;
  accent: string;
  glow: 'blue' | 'teal' | 'flame' | 'none';
}

export const SECTION_THEME: Record<SectionKey, SectionTheme> = {
  problem: { tag: 'Problem', accent: LAND_THEME.signal, glow: 'blue' },
  loop: { tag: 'The loop', accent: LAND_THEME.signal, glow: 'blue' },
  distribution: { tag: 'Distribution', accent: LAND_THEME.publish, glow: 'teal' },
  voice: { tag: 'Voice', accent: LAND_THEME.publish, glow: 'teal' },
  different: { tag: 'Why us', accent: LAND_THEME.draft, glow: 'flame' },
  week: { tag: 'In practice', accent: '#5BC8FF', glow: 'none' },
  who: { tag: 'Who it\'s for', accent: LAND_THEME.signal, glow: 'blue' },
};

export const GLOW_CLASS = {
  blue: 'bg-blue/10',
  teal: 'bg-teal/10',
  flame: 'bg-flame/10',
  none: '',
} as const;
