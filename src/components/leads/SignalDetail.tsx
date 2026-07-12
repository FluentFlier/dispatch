'use client';

import {
  Radio,
  ExternalLink,
  Linkedin,
  Building2,
  Sparkles,
  Send,
  RefreshCw,
  Mail,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { XLogo } from '@/components/ui/BrandIcons';
import type { UnifiedLeadCard } from '@/lib/signals/feed/normalize';
import { sourceBadge, signalTypeLabel, isReachable } from './feed-format';
import {
  resolveSignalOutreach,
  SIGNAL_CONNECT_LIMIT,
  type SignalSendChannel,
} from './signal-outreach';
import { signalButtonBusy, type SignalDetailAction } from '@/lib/leads/busy';

/** Short human label for the chosen send channel, shown on the Approve button. */
function channelActionLabel(channel: SignalSendChannel): string {
  switch (channel) {
    case 'linkedin_connect':
      return 'Approve · LinkedIn';
    case 'x_dm':
      return 'Approve · X DM';
    case 'gmail':
      return 'Approve · Email';
    case 'copy':
      return 'Approve';
    default: {
      const _exhaustive: never = channel;
      return _exhaustive;
    }
  }
}

interface SignalDetailProps {
  card: UnifiedLeadCard;
  /** Current draft text for this signal (edited in place); empty means "not drafted yet". */
  draft: string;
  onDraftChange: (v: string) => void;
  /**
   * Which action is in flight for this signal, or null. Bound per-button so
   * drafting does not blank the Send button and vice versa.
   */
  busyAction: SignalDetailAction | null;
  /** Inline guard notice (from an expected 422 block) to render, or null. */
  notice: string | null;
  onDraft: () => void;
  onSend: () => void;
}

/**
 * Detail panel for a live signal-event card, now with the same draft +
 * approve/send flow directory leads have (`LeadDetail`). It renders the
 * best-effort context (company, detected signal, summary, source link, and a
 * reachable contact or a clear "no reachable contact" callout), then an
 * editable AI draft with a char count and Regenerate, and an Approve action
 * that sends via the channel resolved from the contact (LinkedIn connect > X DM
 * > email). When the safety guard blocks a send (dry-run / cap / working-hours)
 * the endpoint returns 422; that reason is surfaced here as a neutral inline
 * notice rather than an error, keeping the human-approval model consistent with
 * directory leads. When no messaging channel exists the draft can still be
 * generated and copied, but Send is disabled instead of shown as a dead button.
 */
export function SignalDetail({
  card,
  draft,
  onDraftChange,
  busyAction,
  notice,
  onDraft,
  onSend,
}: SignalDetailProps) {
  const badge = sourceBadge(card);
  const reachable = isReachable(card);
  const contact = card.contact;
  const signal = card.signalType ? signalTypeLabel(card.signalType) : 'Signal';
  const plan = resolveSignalOutreach(card);
  const isConnect = plan.channel === 'linkedin_connect';
  const overLimit = isConnect && draft.length > SIGNAL_CONNECT_LIMIT;
  const alreadySent = card.status === 'sent';
  // Per-action flags so drafting and sending spin independently.
  const { draftBusy, sendBusy, anyBusy } = signalButtonBusy(busyAction);

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
              <XLogo className="h-3.5 w-3.5" /> {contact.x_handle}
            </a>
          )}
        </div>
      ) : (
        <div className="bg-bg-tertiary rounded-md p-3 text-sm text-text-secondary">
          No reachable contact on this signal yet.{' '}
          {plan.sendable
            ? 'We can still reach the author via the post channel below.'
            : "It can't be messaged directly, but you can draft a message to copy."}
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

      {/* Inline guard notice (expected 422 block: dry-run / cap / working hours) */}
      {notice && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-sage-light/60 p-3 text-sm text-text-secondary">
          <Info className="h-4 w-4 mt-0.5 shrink-0 text-accent-secondary" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      {/* Sent confirmation */}
      {alreadySent && (
        <div className="rounded-md border border-border bg-sage-light/60 p-3 text-sm text-accent-secondary">
          This signal has been sent.
        </div>
      )}

      {/* Draft */}
      {draft ? (
        <div className="space-y-1">
          <label className="sr-only" htmlFor="signal-draft">Outreach draft</label>
          <textarea
            id="signal-draft"
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            rows={5}
            disabled={alreadySent}
            className="w-full rounded-md border border-border bg-bg-primary p-3 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary disabled:opacity-60"
          />
          {isConnect && (
            <div className={`text-xs text-right ${overLimit ? 'text-red-600' : 'text-text-tertiary'}`}>
              {draft.length}/{SIGNAL_CONNECT_LIMIT}
            </div>
          )}
        </div>
      ) : (
        !alreadySent && (
          <Button variant="primary" size="sm" onClick={onDraft} loading={draftBusy}>
            <Sparkles className="h-4 w-4" /> Draft message
          </Button>
        )
      )}

      {/* Actions */}
      {draft && !alreadySent && (
        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="primary"
            size="sm"
            onClick={onSend}
            loading={sendBusy}
            disabled={!plan.sendable || overLimit || anyBusy}
            title={plan.sendable ? undefined : 'No messaging channel on this signal — copy the draft to send by hand.'}
          >
            {plan.channel === 'gmail' ? <Mail className="h-4 w-4" /> : <Send className="h-4 w-4" />}{' '}
            {channelActionLabel(plan.channel)}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDraft} loading={draftBusy}>
            <RefreshCw className="h-4 w-4" /> Regenerate
          </Button>
        </div>
      )}
    </div>
  );
}
