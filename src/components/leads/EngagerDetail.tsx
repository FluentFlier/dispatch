'use client';

import {
  Radio,
  ExternalLink,
  Linkedin,
  UserPlus,
  Sparkles,
  Send,
  MessageSquare,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { UnifiedLeadCard } from '@/lib/signals/feed/normalize';
import type { WarmContactRow } from '@/lib/social-graph/types';
import { fitPercentage, nurtureStageLabel } from './feed-format';
import { LINKEDIN_CONNECT_NOTE_LIMIT } from '@/lib/leads/constants';

const CONNECT_LIMIT = LINKEDIN_CONNECT_NOTE_LIMIT;

export type EngagerDetailAction = 'plan' | 'draft' | 'connect' | 'dm' | 'dismiss';

interface EngagerDetailProps {
  card: UnifiedLeadCard;
  /** Full engager record once loaded (dossier, draft, stage). 'loading' while fetching. */
  contact: WarmContactRow | 'loading' | null;
  draft: string;
  onDraftChange: (v: string) => void;
  busyAction: EngagerDetailAction | null;
  notice: string | null;
  /** Kick off the research -> comment -> connect -> DM sequence. */
  onPlan: () => void;
  /** Send the drafted LinkedIn connect invite (safety-gated). */
  onSendConnect: () => void;
  /** Send the drafted LinkedIn DM follow-up (safety-gated). */
  onSendDm: () => void;
  onDismiss: () => void;
}

/**
 * Detail panel for a post-engager card (someone who reacted to / commented on
 * the user's own posts). Engagers run the same research -> comment -> connect ->
 * DM nurture sequence directory leads use, so this panel surfaces the research
 * dossier + nurture stage and exposes the human-in-the-loop actions: start the
 * sequence, review/edit the drafted note, and send the connect or the accepted-
 * connection DM (both gated by the Signals safety envelope, which returns an
 * inline notice on an expected block).
 */
export function EngagerDetail({
  card,
  contact,
  draft,
  onDraftChange,
  busyAction,
  notice,
  onPlan,
  onSendConnect,
  onSendDm,
  onDismiss,
}: EngagerDetailProps) {
  const loaded = contact && contact !== 'loading' ? contact : null;
  const stage = loaded?.nurture_stage ?? card.nurtureStage ?? null;
  const stageLabel = nurtureStageLabel(stage);
  const linkedinUrl = card.sourceUrl ?? loaded?.profile_url ?? null;
  const dossier = loaded?.dossier_json ?? null;
  const channel = loaded?.outreach_channel ?? (stage === 'dm_ready' ? 'linkedin_dm' : 'linkedin_connect');
  const isDm = channel === 'linkedin_dm';
  const overLimit = !isDm && draft.length > CONNECT_LIMIT;
  const priorityPercent = fitPercentage(card.score);

  const planned = stage != null && stage !== 'discovered';
  const busyPlan = busyAction === 'plan';
  const busyConnect = busyAction === 'connect';
  const busyDm = busyAction === 'dm';
  const anyBusy = busyAction != null;

  return (
    <div className="space-y-4 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
      {/* Header */}
      <div className="flex items-start gap-3 min-w-0">
        <div className="h-11 w-11 rounded-md border border-border bg-bg-tertiary flex items-center justify-center shrink-0">
          <Linkedin className="h-5 w-5 text-text-tertiary" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1 text-xs tracking-wide text-coral-dark">
            <Radio className="h-3 w-3" aria-hidden="true" /> Post engager
          </p>
          <h2 className="text-xl font-display text-text-primary truncate">
            {card.companyName ?? 'Engager'}
          </h2>
          {card.tagline && (
            <p className="text-sm text-text-secondary truncate">{card.tagline}</p>
          )}
        </div>
      </div>

      {/* Meta chips */}
      <div className="flex flex-wrap gap-1.5">
        {stageLabel && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-sage-light text-accent-secondary">
            {stageLabel}
          </span>
        )}
        {loaded?.category && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg-tertiary text-text-secondary">
            {loaded.category}
          </span>
        )}
        {priorityPercent && (
          <span
            className="text-[11px] px-2 py-0.5 rounded-full bg-bg-tertiary text-text-secondary tabular-nums"
            title="Relative lead priority based on ICP category, engagement, and profile reachability"
            aria-label={`Lead priority: ${priorityPercent}`}
          >
            Lead priority {priorityPercent}
          </span>
        )}
      </div>

      {/* Research dossier */}
      {dossier ? (
        <div className="space-y-2">
          <p className="text-xs tracking-wide text-text-tertiary">Research</p>
          <p className="text-sm text-text-secondary leading-relaxed">{dossier.summary}</p>
          {dossier.whyMatters && (
            <p className="text-sm text-text-secondary leading-relaxed">
              <span className="text-text-tertiary">Why: </span>
              {dossier.whyMatters}
            </p>
          )}
          {dossier.angle && (
            <p className="text-sm text-text-secondary leading-relaxed">
              <span className="text-text-tertiary">Angle: </span>
              {dossier.angle}
            </p>
          )}
        </div>
      ) : (
        card.signalSummary && (
          <p className="text-sm text-text-secondary leading-relaxed">{card.signalSummary}</p>
        )
      )}

      {/* Source */}
      <blockquote className="text-sm text-text-secondary border-l-2 border-border pl-3 py-1">
        {loaded?.source_post_title
          ? `Engaged with your post "${loaded.source_post_title}"`
          : 'Engaged with your content'}
        {linkedinUrl && (
          <>
            {' · '}
            <a
              href={linkedinUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent-primary hover:underline"
            >
              View profile <ExternalLink className="h-3 w-3" />
            </a>
          </>
        )}
      </blockquote>

      {/* Inline guard notice (expected 422 block) */}
      {notice && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-sage-light/60 p-3 text-sm text-text-secondary">
          <Info className="h-4 w-4 mt-0.5 shrink-0 text-accent-secondary" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      {/* Sequence not started yet */}
      {!planned && (
        <Button variant="primary" size="sm" onClick={onPlan} loading={busyPlan}>
          <Sparkles className="h-4 w-4" /> Start sequence
        </Button>
      )}

      {/* Draft review */}
      {planned && draft && (
        <div className="space-y-1">
          <label className="sr-only" htmlFor="engager-draft">
            Outreach draft
          </label>
          <textarea
            id="engager-draft"
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            rows={5}
            className="w-full rounded-md border border-border bg-bg-primary p-3 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          />
          {!isDm && (
            <div className={`text-xs text-right ${overLimit ? 'text-red-600' : 'text-text-tertiary'}`}>
              {draft.length}/{CONNECT_LIMIT}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {planned && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {!isDm && (
            <Button
              variant="primary"
              size="sm"
              onClick={onSendConnect}
              loading={busyConnect}
              disabled={!draft || overLimit || anyBusy}
            >
              <UserPlus className="h-4 w-4" /> Send connect
            </Button>
          )}
          {isDm && (
            <Button
              variant="primary"
              size="sm"
              onClick={onSendDm}
              loading={busyDm}
              disabled={!draft || anyBusy}
            >
              <MessageSquare className="h-4 w-4" /> Send DM
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onPlan} loading={busyPlan} disabled={anyBusy}>
            <Send className="h-4 w-4" /> Re-plan
          </Button>
          <Button variant="ghost" size="sm" onClick={onDismiss} disabled={anyBusy}>
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}
