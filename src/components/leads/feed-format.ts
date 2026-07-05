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
import type { SignalType } from '@/lib/signals/types';

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
  };
  return labels[type] ?? 'Signal';
}

/**
 * Whether a card has a reachable contact. A card is reachable only when it is
 * not explicitly marked `no_contact` and it carries at least one contact
 * channel, so the feed never presents an unreachable lead as messageable.
 */
export function isReachable(card: UnifiedLeadCard): boolean {
  if (card.contactStatus === 'no_contact') return false;
  const c = card.contact;
  if (!c) return false;
  return Boolean(c.linkedin_url || c.x_handle || c.email || c.name);
}

/** Short label for the contact-status pill: resolved vs no-contact. */
export function contactPillLabel(card: UnifiedLeadCard): 'Contact ready' | 'No contact' {
  return isReachable(card) ? 'Contact ready' : 'No contact';
}
