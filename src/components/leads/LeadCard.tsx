'use client';

import { FolderOpen, Pin, Radio } from 'lucide-react';
import type { LeadQualityBreakdown, UnifiedLeadCard } from '@/lib/signals/feed/normalize';
import { importedLabel, signalTypeLabel, sourceBadge } from './feed-format';

interface LeadCardProps {
  card: UnifiedLeadCard;
  selected: boolean;
  followed: boolean;
  onSelect: () => void;
  /** Keyboard handler so arrow-key navigation can be owned by the parent list. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  /** When provided, renders a bulk-select checkbox in a left gutter. */
  checked?: boolean;
  onToggleSelect?: () => void;
}

function qualityTone(card: UnifiedLeadCard): string {
  switch (card.quality?.tier) {
    case 'urgent':
      return 'bg-coral-light text-coral-dark';
    case 'high':
      return 'bg-sage-light text-accent-secondary';
    case 'needs_contact':
      return 'bg-amber-100 text-amber-800';
    default:
      return 'bg-bg-tertiary text-text-secondary';
  }
}

function fallbackQuality(card: UnifiedLeadCard): LeadQualityBreakdown {
  return {
    tier: card.score >= 0.75 ? 'high' : card.score >= 0.45 ? 'medium' : 'needs_review',
    label: card.score >= 0.75 ? 'Strong fit' : card.score >= 0.45 ? 'Possible fit' : 'Needs review',
    fitLabel: card.score >= 0.75 ? 'Strong ICP fit' : card.score >= 0.45 ? 'Possible ICP fit' : 'Weak ICP fit',
    reachabilityLabel: card.contact ? 'Contact ready' : 'Needs contact',
    timingLabel: 'In backlog',
    reasons: [card.tagline || card.signalSummary || 'Review this lead'].filter(Boolean) as string[],
    blockers: card.contact ? [] : ['No reachable contact yet'],
  };
}

/**
 * A single row in the unified leads feed. The row is deliberately compact:
 * verdict, evidence, reachability, and next action. The rich company context
 * stays in the right-side viewer after selection.
 */
export function LeadCard({ card, selected, followed, onSelect, onKeyDown, checked, onToggleSelect }: LeadCardProps) {
  const badge = sourceBadge(card);
  const signal = card.signalType ? signalTypeLabel(card.signalType) : null;
  const summary = card.tagline || card.signalSummary || null;
  const imported = importedLabel(card.firstSeenAt);
  const quality = card.quality ?? fallbackQuality(card);
  const reachabilityScore = card.reachabilityScore ?? (card.contact ? 1 : 0);
  const primaryReason = quality.reasons[0] ?? summary;
  const secondaryReason = quality.reasons.find((r) => r !== primaryReason) ?? null;

  return (
    <div className={`flex items-stretch border-b border-border last:border-0 ${followed ? 'bg-sage-light/40' : ''}`}>
      {onToggleSelect && (
        <label
          className="flex items-center pl-3 pr-1 cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={Boolean(checked)}
            onChange={onToggleSelect}
            aria-label={`Select ${card.companyName ?? 'lead'}`}
            className="h-4 w-4 rounded border-border accent-accent-primary cursor-pointer"
          />
        </label>
      )}
      <button
        type="button"
        id={card.id}
        role="option"
        aria-selected={selected}
        aria-label={`${card.companyName ?? 'Unknown company'}, ${badge.label} ${
          badge.live ? 'live signal' : 'directory'
        }${signal ? `, ${signal}` : ''}, ${quality.label}, ${quality.reachabilityLabel}`}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        className={`flex-1 min-w-0 text-left px-4 py-3 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-inset ${
          selected
            ? 'bg-bg-primary border-l-2 border-l-accent-primary'
            : 'hover:bg-bg-tertiary'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className={`inline-flex items-center gap-1 text-[10px] tracking-wide px-1.5 py-0.5 rounded ${
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
            {card.batch ? ` - ${card.batch}` : ''}
          </span>
          <span className="inline-flex min-w-0 items-center gap-1 text-[10px] text-text-tertiary">
            {followed && <Pin className="h-3 w-3 shrink-0 text-accent-secondary" aria-hidden="true" />}
            {imported && <span className="truncate">{imported}</span>}
          </span>
        </div>

        <p className="text-sm font-medium text-text-primary line-clamp-1 mt-1">
          {card.companyName ?? 'Unknown company'}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${qualityTone(card)}`}>
            {quality.label}
          </span>
          {signal && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-secondary">
              {signal}
            </span>
          )}
        </div>

        {primaryReason && (
          <p className="text-xs text-text-secondary line-clamp-1 mt-1">{primaryReason}</p>
        )}
        {secondaryReason && (
          <p className="text-[11px] text-text-tertiary line-clamp-1 mt-0.5">{secondaryReason}</p>
        )}

        {card.contact?.name && (
          <p className="text-[11px] text-text-secondary line-clamp-1 mt-1">
            {card.contact.name}
            {card.contact.role ? (
              <span className="text-text-tertiary"> - {card.contact.role}</span>
            ) : (
              <span className="text-amber-600"> - role unknown</span>
            )}
          </p>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              reachabilityScore > 0
                ? 'bg-sage-light text-accent-secondary'
                : 'bg-bg-tertiary text-text-tertiary'
            }`}
          >
            {quality.reachabilityLabel}
          </span>
        </div>
      </button>
    </div>
  );
}
