'use client';

import { Pin, Radio, FolderOpen } from 'lucide-react';
import type { UnifiedLeadCard } from '@/lib/signals/feed/normalize';
import {
  sourceBadge,
  signalTypeLabel,
  contactPillLabel,
  isReachable,
} from './feed-format';

interface LeadCardProps {
  card: UnifiedLeadCard;
  selected: boolean;
  followed: boolean;
  onSelect: () => void;
  /** Keyboard handler so arrow-key navigation can be owned by the parent list. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
}

/**
 * A single row in the unified leads feed. Renders one `UnifiedLeadCard`
 * regardless of whether it originated as a directory lead or a live signal
 * event: a source badge (live post vs directory), company name, a signal chip
 * or tagline, batch, a contact-status pill, and the score. Followed companies
 * get a pin marker. The whole row is a button so it is keyboard-focusable and
 * announces itself via `aria-label` for screen readers.
 */
export function LeadCard({ card, selected, followed, onSelect, onKeyDown }: LeadCardProps) {
  const badge = sourceBadge(card);
  const reachable = isReachable(card);
  const pill = contactPillLabel(card);
  // Prefer the signal chip when present; fall back to the tagline for directory rows.
  const signal = card.signalType ? signalTypeLabel(card.signalType) : null;
  const summary = card.tagline || card.signalSummary || null;

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-label={`${card.companyName ?? 'Unknown company'}, ${badge.label} ${
        badge.live ? 'live signal' : 'directory'
      }${signal ? `, ${signal}` : ''}, ${pill}, score ${card.score.toFixed(2)}`}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={`w-full text-left px-4 py-3 border-b border-border last:border-0 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-inset ${
        selected
          ? 'bg-bg-primary border-l-2 border-l-accent-primary'
          : 'hover:bg-bg-tertiary'
      } ${followed ? 'bg-sage-light/40' : ''}`}
    >
      {/* Top line: source badge + score */}
      <div className="flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded ${
            badge.live
              ? 'bg-coral-light text-coral-dark'
              : 'bg-accent-light text-accent-primary'
          }`}
        >
          {badge.live ? (
            <Radio className="h-3 w-3" aria-hidden="true" />
          ) : (
            <FolderOpen className="h-3 w-3" aria-hidden="true" />
          )}
          {badge.label}
          {card.batch ? ` · ${card.batch}` : ''}
        </span>
        <span className="text-xs text-text-tertiary shrink-0 flex items-center gap-1">
          {followed && <Pin className="h-3 w-3 text-accent-secondary" aria-hidden="true" />}
          {card.score.toFixed(2)}
        </span>
      </div>

      {/* Company name */}
      <p className="text-sm font-medium text-text-primary line-clamp-1 mt-1">
        {card.companyName ?? 'Unknown company'}
      </p>

      {/* Signal chip or tagline */}
      {signal ? (
        <span className="inline-block text-[11px] px-1.5 py-0.5 rounded bg-sage-light text-accent-secondary mt-1">
          {signal}
        </span>
      ) : summary ? (
        <p className="text-xs text-text-tertiary line-clamp-1 mt-0.5">{summary}</p>
      ) : null}

      {/* Contact-status pill */}
      <div className="mt-1.5">
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded ${
            reachable
              ? 'bg-sage-light text-accent-secondary'
              : 'bg-bg-tertiary text-text-tertiary'
          }`}
        >
          {pill}
        </span>
      </div>
    </button>
  );
}
