import type { SignalPlatform, SignalSourceType } from '@/lib/signals/types';

/** Default watchlist for Rho / Dylan design partner alpha */
export const DEFAULT_GTM_SOURCES: Array<{
  platform: SignalPlatform;
  handle_or_url: string;
  source_type: SignalSourceType;
  label: string;
}> = [
  { platform: 'x', handle_or_url: 'ycombinator', source_type: 'account', label: 'Y Combinator' },
  { platform: 'x', handle_or_url: 'Techstars', source_type: 'account', label: 'Techstars' },
  { platform: 'x', handle_or_url: 'a16z', source_type: 'account', label: 'a16z' },
  { platform: 'x', handle_or_url: 'sequoia', source_type: 'account', label: 'Sequoia' },
  { platform: 'x', handle_or_url: 'harj', source_type: 'person_profile', label: 'Harj Taggar' },
  { platform: 'linkedin', handle_or_url: 'https://www.linkedin.com/company/y-combinator/', source_type: 'company_page', label: 'Y Combinator LI' },
];

export const ACCELERATOR_KEYWORDS = [
  'yc s24', 'yc w25', 'yc s25', 'yc w24', 'y combinator',
  'techstars', 'demo day', 'batch', 'accelerator', 'got into yc',
  'accepted to yc', 'joining yc', 'excited to announce',
];

export const FUNDING_KEYWORDS = [
  'we just raised', 'just raised', 'seed round', 'series a', 'series b',
  'backed by', 'funding round', 'closed our', 'million in funding',
  'proud to announce our funding',
];

export const LAUNCH_KEYWORDS = [
  'launching today', 'just launched', 'now live', 'introducing',
  'shipping', 'public beta',
];

/** Minimum confidence to create a signal event */
export const SIGNAL_CONFIDENCE_THRESHOLD = 0.55;

/** Starter GTM playbook for fintech design partners (Rho / Dylan alpha) */
export const DEFAULT_GTM_PLAYBOOK = {
  icp: 'Seed–Series B fintech and B2B startups (YC, Techstars). Founders and finance leads who need modern business banking and treasury.',
  pitch:
    'Rho helps high-growth startups consolidate banking, cards, and spend — fewer tools, clearer runway, faster close.',
  objections:
    'Already on Mercury/Brex → Rho consolidates banking + cards + AP in one place. Too early → start with banking + cards, grow into treasury.',
  proof_points: 'Used by YC companies; unified banking + corporate cards + bill pay.',
  cta_style: 'Soft ask: offer a 15-min walkthrough tied to their batch/funding news — never generic "pick your brain".',
} as const;
