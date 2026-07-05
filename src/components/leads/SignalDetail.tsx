'use client';

import { Radio, ExternalLink, Linkedin, Twitter, Building2 } from 'lucide-react';
import type { UnifiedLeadCard } from '@/lib/signals/feed/normalize';
import { sourceBadge, signalTypeLabel, isReachable } from './feed-format';

interface SignalDetailProps {
  card: UnifiedLeadCard;
}

/**
 * Detail panel for a live signal-event card. Directory leads have a rich,
 * actionable panel (`LeadDetail`); a signal event is a lighter, read-only
 * record: the company, the detected signal, its summary/source fact, a link to
 * the originating post, and either the surfaced contact or a clear "no reachable
 * contact" callout. Signal-outreach actions are not wired into this screen, so
 * this panel deliberately exposes no send controls rather than showing dead
 * buttons.
 */
export function SignalDetail({ card }: SignalDetailProps) {
  const badge = sourceBadge(card);
  const reachable = isReachable(card);
  const contact = card.contact;
  const signal = card.signalType ? signalTypeLabel(card.signalType) : 'Signal';

  return (
    <div className="space-y-4 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
      {/* Header */}
      <div className="flex items-start gap-3 min-w-0">
        <div className="h-11 w-11 rounded-md border border-border bg-bg-tertiary flex items-center justify-center shrink-0">
          <Building2 className="h-5 w-5 text-text-tertiary" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1 text-xs font-mono uppercase tracking-wide text-coral-dark">
            <Radio className="h-3 w-3" aria-hidden="true" /> {badge.label} live signal
          </p>
          <h2 className="text-xl font-display text-text-primary truncate">
            {card.companyName ?? 'Unknown company'}
          </h2>
          <span className="inline-block text-[11px] px-1.5 py-0.5 rounded bg-sage-light text-accent-secondary mt-1">
            {signal}
          </span>
        </div>
      </div>

      {/* Signal summary */}
      {card.signalSummary && (
        <div>
          <p className="text-xs font-mono uppercase tracking-wide text-text-tertiary mb-1">What happened</p>
          <p className="text-sm text-text-secondary leading-relaxed">{card.signalSummary}</p>
        </div>
      )}

      {/* Meta */}
      <div className="flex flex-wrap gap-1.5">
        {card.batch && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg-tertiary text-text-secondary">{card.batch}</span>
        )}
        {card.accelerator && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg-tertiary text-text-secondary">{card.accelerator}</span>
        )}
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg-tertiary text-text-secondary">
          Score {card.score.toFixed(2)}
        </span>
      </div>

      {/* Contact block */}
      {reachable && contact ? (
        <div className="text-sm text-text-secondary">
          {contact.name}
          {contact.role ? ` · ${contact.role}` : ''}
          {contact.linkedin_url && (
            <a href={contact.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-primary hover:underline ml-2">
              <Linkedin className="h-3.5 w-3.5" /> LinkedIn
            </a>
          )}
          {contact.x_handle && (
            <a href={`https://x.com/${contact.x_handle.replace(/^@/, '')}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-primary hover:underline ml-2">
              <Twitter className="h-3.5 w-3.5" /> {contact.x_handle}
            </a>
          )}
        </div>
      ) : (
        <div className="bg-bg-tertiary rounded-md p-3 text-sm text-text-secondary">
          No reachable contact on this signal yet. It can&apos;t be messaged directly.
        </div>
      )}

      {/* Source fact / link to the originating post */}
      <blockquote className="text-sm text-text-secondary border-l-2 border-border pl-3 py-1">
        Detected from {badge.label}
        {card.sourceUrl && (
          <>
            {' · '}
            <a href={card.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-primary hover:underline">
              View post <ExternalLink className="h-3 w-3" />
            </a>
          </>
        )}
      </blockquote>
    </div>
  );
}
