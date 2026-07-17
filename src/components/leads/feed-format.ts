/**
 * Presentation helpers for the unified leads feed.
 *
 * Both directory leads and real-time signal events reach the UI as a single
 * `UnifiedLeadCard` shape, but they still need per-source labels, human-readable
 * signal names, and contact-status wording. Centralizing that mapping here keeps
 * `LeadCard` / `UnifiedFeed` free of branching copy and makes the wording
 * unit-testable in isolation (no React, no DOM).
 */

import type { UnifiedLeadCard } from '@/lib/signals/feed/normalize';
import type { NurtureStage, SignalType } from '@/lib/signals/types';

/** How a card's `source` should read in the UI (short badge label + whether it is a live post). */
export interface SourceBadge {
  label: string;
  /** Live posts (X/LinkedIn signals) get the "live" treatment; directories get the neutral one. */
  live: boolean;
}

/** Maps a card's raw `source` to its badge label and live/directory treatment. */
export function sourceBadge(card: UnifiedLeadCard): SourceBadge {
  switch (card.source) {
    case 'x':
      return { label: 'X', live: true };
    case 'linkedin':
      return { label: 'LinkedIn', live: true };
    case 'yc_directory':
    case 'yc_launches':
      return { label: 'YC', live: false };
    case 'web_discovery':
      return { label: 'Web', live: false };
    case 'product_hunt':
      return { label: 'Product Hunt', live: false };
    default:
      return { label: 'Manual', live: false };
  }
}

/** Human-readable label for a signal type, used in the signal chip. */
export function signalTypeLabel(type: SignalType): string {
  const labels: Record<SignalType, string> = {
    accelerator_join: 'Joined accelerator',
    funding_round: 'Raised funding',
    role_change: 'New role',
    launch: 'Launched',
    other: 'Signal',
    keyword_match: 'Posted about topic',
    field_change: 'Profile changed',
  };
  return labels[type] ?? 'Signal';
}

/**
 * Whether a card has a reachable contact. A card is reachable only when it is
 * not explicitly marked `no_contact` and it carries an actual messaging
 * channel (linkedin_url, x_handle, or email). A bare `name` (e.g. a signal
 * card's `{ name: person_name }` contact, which has no channel at all) is NOT
 * enough, so the feed never presents a name-only contact as "Contact ready".
 */
export function isReachable(card: UnifiedLeadCard): boolean {
  if (card.contactStatus === 'no_contact') return false;
  const c = card.contact;
  if (!c) return false;
  return Boolean(c.linkedin_url || c.x_handle || c.email);
}

/** Score below which the chip is hidden rather than shown as a near-zero number. */
const SCORE_CHIP_MIN = 0.15;

/**
 * Formats a card's ICP score for display, or hides it entirely when it is
 * near zero. ICP scoring correctly returns ~0 for off-ICP companies, but a
 * feed full of "0.00" chips reads as broken rather than "working as
 * intended", so below `SCORE_CHIP_MIN` we hide the chip instead of showing
 * a number that looks like a bug. This is display-only: sort order still
 * uses the real underlying score.
 */
export function scoreChip(score: number): string | null {
  if (score < SCORE_CHIP_MIN) return null;
  return score.toFixed(2);
}

/** Short label for the contact-status pill: resolved vs no-contact. */
export function contactPillLabel(card: UnifiedLeadCard): 'Contact ready' | 'No contact' {
  return isReachable(card) ? 'Contact ready' : 'No contact';
}

/**
 * "Imported <Mon D> · <relative>" for the card footer, so freshness is visible at
 * a glance (the batch shows company recency; this shows when WE pulled the lead).
 * Returns null for a missing/invalid date so the card omits the line rather than
 * rendering "Imported Invalid Date". `now` is injectable for deterministic tests.
 */
export function importedLabel(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const date = new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const days = Math.floor((now - t) / 86_400_000);
  const rel = days <= 0 ? 'today' : days === 1 ? '1d ago' : `${days}d ago`;
  return `Imported ${date} · ${rel}`;
}

/**
 * Human-readable label for an engager's nurture stage, used on the engager
 * detail chip. Returns `null` for `discovered`/absent stages (the sequence
 * hasn't meaningfully started, so no chip is shown) rather than a bare
 * "Discovered" that reads as noise.
 */
export function nurtureStageLabel(stage: NurtureStage | string | null | undefined): string | null {
  if (!stage || stage === 'discovered') return null;
  const labels: Record<NurtureStage, string> = {
    discovered: 'Discovered',
    planned: 'Planned',
    engaging: 'Engaging',
    connect_ready: 'Connect ready',
    connect_sent: 'Connect sent',
    nurturing: 'Nurturing',
    dm_ready: 'DM ready',
    dm_sent: 'DM sent',
    replied: 'Replied',
    closed: 'Closed',
  };
  return labels[stage as NurtureStage] ?? null;
}
