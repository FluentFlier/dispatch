import type { SignalPlatform, SignalSourceType } from '@/lib/signals/types';

type GtmSource = {
  platform: SignalPlatform;
  handle_or_url: string;
  source_type: SignalSourceType;
  label: string;
};

/**
 * Neutral starter watchlist seeded for every new workspace: broadly useful,
 * public startup-ecosystem accounts, with no design-partner-specific handles.
 * A generic user should never inherit another tenant's private watchlist.
 */
export const DEFAULT_GTM_SOURCES: GtmSource[] = [
  { platform: 'x', handle_or_url: 'ycombinator', source_type: 'account', label: 'Y Combinator' },
  { platform: 'x', handle_or_url: 'Techstars', source_type: 'account', label: 'Techstars' },
  { platform: 'x', handle_or_url: 'a16z', source_type: 'account', label: 'a16z' },
  { platform: 'x', handle_or_url: 'sequoia', source_type: 'account', label: 'Sequoia' },
];

/**
 * Fuller watchlist for the Rho / Dylan design-partner alpha only. Seeded solely
 * for the workspace whose id matches DESIGN_PARTNER_WORKSPACE_ID (see
 * isDesignPartnerWorkspace); never leaked into a generic workspace.
 */
export const DESIGN_PARTNER_GTM_SOURCES: GtmSource[] = [
  ...DEFAULT_GTM_SOURCES,
  { platform: 'x', handle_or_url: 'harj', source_type: 'person_profile', label: 'Harj Taggar' },
  { platform: 'linkedin', handle_or_url: 'https://www.linkedin.com/company/y-combinator/', source_type: 'company_page', label: 'Y Combinator LI' },
];

/**
 * True when the workspace is the configured design-partner workspace. Gating the
 * Rho-specific watchlist + sales playbook behind this keeps alpha data out of
 * every other tenant. Set DESIGN_PARTNER_WORKSPACE_ID in env to enable.
 */
export function isDesignPartnerWorkspace(workspaceId: string): boolean {
  const id = process.env.DESIGN_PARTNER_WORKSPACE_ID?.trim();
  return Boolean(id && id === workspaceId);
}

/** Watchlist for a workspace: design-partner set if gated, else the neutral set. */
export function gtmSourcesForWorkspace(workspaceId: string): GtmSource[] {
  return isDesignPartnerWorkspace(workspaceId) ? DESIGN_PARTNER_GTM_SOURCES : DEFAULT_GTM_SOURCES;
}

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

/**
 * Neutral starter GTM playbook seeded for every new workspace. It carries NO
 * company-specific pitch (that was the Rho alpha leak); instead it prompts the
 * user to fill in their own ICP/pitch in Setup, and keeps only outreach-style
 * guidance that is true for anyone.
 */
export const DEFAULT_GTM_PLAYBOOK = {
  icp: 'Describe who you sell to: stage, industry, and the roles you reach. Edit this in Setup.',
  pitch: 'One or two sentences on what you offer and the outcome it drives. Keep it specific and jargon-free.',
  objections: 'List the objections you hear most and a one-line response to each.',
  proof_points: 'Add concrete proof: customers, results, or credibility markers.',
  cta_style: 'Soft ask tied to a specific signal (their launch, funding, or hiring), never a generic "pick your brain".',
} as const;

/** Rho / Dylan design-partner sales playbook. Seeded ONLY for that workspace. */
export const DESIGN_PARTNER_GTM_PLAYBOOK = {
  icp: 'Seed-Series B fintech and B2B startups (YC, Techstars). Founders and finance leads who need modern business banking and treasury.',
  pitch:
    'Rho helps high-growth startups consolidate banking, cards, and spend - fewer tools, clearer runway, faster close.',
  objections:
    'Already on Mercury/Brex -> Rho consolidates banking + cards + AP in one place. Too early -> start with banking + cards, grow into treasury.',
  proof_points: 'Used by YC companies; unified banking + corporate cards + bill pay.',
  cta_style: 'Soft ask: offer a 15-min walkthrough tied to their batch/funding news - never generic "pick your brain".',
} as const;

/** Playbook for a workspace: design-partner sales playbook if gated, else neutral. */
export function gtmPlaybookForWorkspace(workspaceId: string): Record<string, string> {
  return isDesignPartnerWorkspace(workspaceId) ? DESIGN_PARTNER_GTM_PLAYBOOK : DEFAULT_GTM_PLAYBOOK;
}
