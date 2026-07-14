'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw,
  Sparkles,
  Send,
  X,
  Pin,
  ExternalLink,
  Mail,
  Building2,
  Linkedin,
  Globe,
  MessageSquare,
  Clock,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { YCLogo, XLogo } from '@/components/ui/BrandIcons';
import type { SignalLeadWithContacts, LeadPlaybook } from '@/lib/signals/types';
import type { YcCompanyDetail } from '@/lib/signals/ingest/yc-algolia';
import { leadButtonBusy, type LeadDetailAction } from '@/lib/leads/busy';
import { linkedInBadgeState } from '@/lib/leads/verified-badge';

export type { LeadDetailAction };

/** LinkedIn connect-note character ceiling; drafts over this can't be approved. */
export const CONNECT_LIMIT = 300;

/** Short source tag for a directory lead. */
export function sourceTag(lead: SignalLeadWithContacts): string {
  if (lead.source === 'web_discovery') return 'Web';
  if (lead.source === 'product_hunt') return lead.batch ? `PH · ${lead.batch}` : 'PH';
  if (lead.source === 'manual') return 'ICP';
  const src = 'YC';
  return lead.batch ? `${src} · ${lead.batch}` : src;
}

/** A label:value row in the company info box. */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 border-b border-border/50 last:border-0 text-xs">
      <span className="text-text-tertiary">{label}</span>
      <span className="text-text-primary text-right font-medium">{children}</span>
    </div>
  );
}

/** A square icon button linking to an external URL (website / YC / LinkedIn / X). */
function IconLink({ href, title, children }: { href: string; title: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      aria-label={title}
      className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-bg-secondary hover:bg-bg-primary text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
    >
      {children}
    </a>
  );
}

/**
 * Company "About" text clamped to a short preview with a Read more / Show less
 * toggle, so a long description never floods the card and pushes the info box
 * and draft below the fold. Expands in place; no toggle shown for short text.
 */
function AboutText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const PREVIEW_LIMIT = 200;
  const isLong = text.length > PREVIEW_LIMIT;
  const shown = !isLong || expanded ? text : `${text.slice(0, PREVIEW_LIMIT).trimEnd()}...`;

  return (
    <>
      <p className="text-xs tracking-wide text-text-tertiary mb-1">About</p>
      <p className="text-sm text-text-secondary leading-relaxed">{shown}</p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-1 text-xs font-medium text-accent-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary rounded"
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}
    </>
  );
}

interface LeadDetailProps {
  lead: SignalLeadWithContacts;
  company: YcCompanyDetail | 'loading' | 'error' | undefined;
  /** Retry a failed company-info fetch (re-arms the parent's fetch effect). */
  onRetryCompany?: () => void;
  draft: string;
  onDraftChange: (v: string) => void;
  busyAction: LeadDetailAction | null;
  followed: boolean;
  /** Draft / regenerate. An optional instruction rewrites in that direction. */
  onDraft: (rewriteInstruction?: string) => void;
  /** Run the full voice + critique loop for a higher-fidelity rewrite (slower). */
  onPolish?: () => void;
  onApprove: (channel?: 'linkedin_connect' | 'linkedin_dm' | 'x_dm') => void;
  onEmail: () => void;
  onDismiss: () => void;
  onSnooze?: () => void;
  onResolve: (force?: boolean) => void;
  onFollow: () => void;
  onPlanNurture?: () => void;
  /** Persist free-text edits to the plan (why / angle / step labels). */
  onEditPlan?: (edit: { whyThem?: string; angle?: string; stepLabels?: string[] }) => void;
  onToggleStep?: (stepIndex: number, status: 'pending' | 'done') => void;
  onDraftFollowup?: () => void;
  onCheckConnection?: () => void;
  onDraftReply?: () => void;
  onSendReply?: () => void;
  onMarkConversion?: (stage: 'interested' | 'meeting_booked' | 'not_now' | 'lost') => void;
  accepted?: boolean;
}

interface LeadNote {
  id: string;
  body: string;
  created_at: string;
}

/**
 * The Maps-style detail panel for a directory lead: company card (logo, about,
 * info box, tags, social links, photo strip), a contact block (or a clear "no
 * reachable contact" callout so an unmessageable lead is never shown as ready),
 * a source-fact strip, and the editable draft with a 300-char count plus the
 * Approve / Email / Regenerate / Dismiss actions. Extracted verbatim from the
 * leads page so the unified feed can reuse it unchanged.
 */
export function LeadDetail({
  lead,
  company,
  onRetryCompany,
  draft,
  onDraftChange,
  busyAction,
  followed,
  onDraft,
  onPolish,
  onApprove,
  onEmail,
  onDismiss,
  onSnooze,
  onResolve,
  onFollow,
  onPlanNurture,
  onEditPlan,
  onToggleStep,
  onDraftFollowup,
  onCheckConnection,
  onDraftReply,
  onSendReply,
  onMarkConversion,
  accepted,
}: LeadDetailProps) {
  const { draftBusy, planBusy, approveBusy, resolveBusy, followupBusy, checkBusy, replyBusy, anyBusy } =
    leadButtonBusy(busyAction);
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [noteText, setNoteText] = useState('');
  const [notesLoading, setNotesLoading] = useState(false);
  const [threadMessages, setThreadMessages] = useState<Array<{ id: string; direction: string; body: string; sent_at: string }>>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  // Free-text "how to change it" instruction for a targeted rewrite of the draft.
  const [rewriteInstruction, setRewriteInstruction] = useState('');

  const loadNotes = useCallback(async () => {
    setNotesLoading(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}/notes`);
      const data = await res.json();
      if (res.ok) setNotes(data.notes ?? []);
    } catch {
      // Notes are optional - a missing table should not break the panel.
    } finally {
      setNotesLoading(false);
    }
  }, [lead.id]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const loadThread = useCallback(async () => {
    if (!lead.needs_reply && lead.nurture_stage !== 'replied') return;
    setThreadLoading(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}/messages`);
      const data = await res.json();
      if (res.ok) setThreadMessages(data.messages ?? []);
    } catch {
      // Thread is optional - missing table should not break the panel.
    } finally {
      setThreadLoading(false);
    }
  }, [lead.id, lead.needs_reply, lead.nurture_stage]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  const addNote = async () => {
    const body = noteText.trim();
    if (!body) return;
    const res = await fetch(`/api/leads/${lead.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    const data = await res.json();
    if (res.ok && data.note) {
      setNotes((prev) => [...prev, data.note]);
      setNoteText('');
    }
  };

  const contact = lead.primary_contact;
  const noContact = lead.contact_status === 'no_contact';
  const leadEmail = lead.contacts?.find((c) => c.email)?.email ?? null;
  const xHandle = contact?.x_handle?.trim() || lead.contacts?.find((c) => c.x_handle)?.x_handle?.trim() || null;
  const hasLinkedIn = Boolean(contact?.linkedin_url?.trim());
  const overLimit = draft.length > CONNECT_LIMIT;
  const fact = lead.source_fact as { batch?: string; tagline?: string };
  const inReplyMode = Boolean(lead.needs_reply || lead.nurture_stage === 'replied');

  const detail = company && company !== 'loading' && company !== 'error' ? company : null;
  const loadingCompany = company === 'loading';
  const companyError = company === 'error';
  const tagline = detail?.oneLiner || lead.tagline || null;
  const website = detail?.website || lead.website || null;
  const ycUrl = detail?.ycUrl || (lead.external_id && lead.source === 'yc_directory'
    ? `https://www.ycombinator.com/companies/${lead.external_id}`
    : null);
  const industries = (detail?.industries?.length ? detail.industries : lead.tags) ?? [];
  const photos = detail?.photos ?? [];
  const batch = detail?.batch || lead.batch;
  const infoRows: Array<{ label: string; value: React.ReactNode }> = [];
  if (detail?.yearFounded) infoRows.push({ label: 'Founded', value: detail.yearFounded });
  if (batch) infoRows.push({ label: 'Batch', value: batch });
  if (detail?.teamSize) infoRows.push({ label: 'Team size', value: detail.teamSize });
  if (detail?.status)
    infoRows.push({
      label: 'Status',
      value: (
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${detail.status.toLowerCase() === 'active' ? 'bg-green-500' : 'bg-text-tertiary'}`} />
          {detail.status}
        </span>
      ),
    });
  if (detail?.location) infoRows.push({ label: 'Location', value: detail.location });
  if (detail?.primaryPartner)
    infoRows.push({
      label: 'Primary partner',
      value: detail.primaryPartner.url ? (
        <a href={detail.primaryPartner.url} target="_blank" rel="noreferrer" className="text-accent-primary hover:underline">
          {detail.primaryPartner.name}
        </a>
      ) : (
        detail.primaryPartner.name
      ),
    });

  return (
    <div className="space-y-4 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
      {/* Header: logo + name + tagline + follow */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {detail?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={detail.logoUrl} alt="" className="h-11 w-11 rounded-md border border-border object-contain bg-white shrink-0" />
          ) : (
            <div className="h-11 w-11 rounded-md border border-border bg-bg-tertiary flex items-center justify-center shrink-0">
              <Building2 className="h-5 w-5 text-text-tertiary" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-xs tracking-wide text-text-tertiary">{sourceTag(lead)}</p>
            <h2 className="text-xl font-display text-text-primary truncate">{lead.company_name}</h2>
            {tagline && <p className="text-sm text-text-secondary line-clamp-2">{tagline}</p>}
            {(lead.name_history ?? []).length > 0 && (
              <p className="text-xs text-text-tertiary">Renamed · was {lead.name_history[lead.name_history.length - 1]}</p>
            )}
          </div>
        </div>
        <button
          onClick={onFollow}
          aria-pressed={followed}
          className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-border shrink-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary ${followed ? 'text-accent-secondary bg-sage-light' : 'text-text-secondary hover:bg-bg-tertiary'}`}
        >
          <Pin className="h-3.5 w-3.5" /> {followed ? 'Following' : 'Follow'}
        </button>
      </div>

      {/* Body: About on the left, info box + tags on the right */}
      {companyError && !detail ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-secondary">
          <span>Could not load company info.</span>
          {onRetryCompany && (
            <Button variant="ghost" size="sm" onClick={onRetryCompany}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          )}
        </div>
      ) : loadingCompany && !detail ? (
        <div className="h-28 rounded-lg bg-bg-tertiary animate-pulse" />
      ) : (
        <div className="flex flex-col sm:flex-row gap-4">
          {/* About (left) */}
          <div className="flex-1 min-w-0">
            {detail?.description ? (
              <AboutText text={detail.description} />
            ) : (
              <p className="text-sm text-text-tertiary italic">No public description yet.</p>
            )}
          </div>
          {/* Info box + tags (right) */}
          <div className="w-full sm:w-60 shrink-0 space-y-2">
            {infoRows.length > 0 && (
              <div className="border border-border rounded-lg px-3 bg-bg-primary">
                {infoRows.map((r) => (
                  <InfoRow key={r.label} label={r.label}>{r.value}</InfoRow>
                ))}
              </div>
            )}
            {industries.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {industries.slice(0, 6).map((t) => (
                  <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-bg-tertiary text-text-secondary">{t}</span>
                ))}
              </div>
            )}
            {/* Social / quick links, right below the tags */}
            <div className="flex flex-wrap gap-2 pt-0.5">
              {website && <IconLink href={website} title="Website"><Globe className="h-4 w-4" /></IconLink>}
              {ycUrl && <IconLink href={ycUrl} title="YC page"><YCLogo className="h-4 w-4" /></IconLink>}
              {(detail?.linkedinUrl || contact?.linkedin_url) && (
                <IconLink href={(detail?.linkedinUrl || contact?.linkedin_url)!} title="LinkedIn"><Linkedin className="h-4 w-4" /></IconLink>
              )}
              {detail?.twitterUrl && <IconLink href={detail.twitterUrl} title="X / Twitter"><XLogo className="h-4 w-4" /></IconLink>}
            </div>
          </div>
        </div>
      )}

      {/* Photos (Maps-style strip) */}
      {photos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.slice(0, 6).map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={src} alt="" className="h-24 w-40 rounded-md border border-border object-cover shrink-0 bg-bg-tertiary" />
          ))}
        </div>
      )}

      {/* Contact block */}
      {noContact ? (
        <div className="bg-bg-tertiary rounded-md p-3 text-sm text-text-secondary flex items-center justify-between gap-3">
          <span>No reachable contact found. This lead can&apos;t be messaged yet.</span>
          <Button variant="ghost" size="sm" onClick={() => onResolve(false)} loading={resolveBusy}>Try to resolve</Button>
        </div>
      ) : contact ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-text-secondary">
            {contact.name}
            {contact.role ? ` · ${contact.role}` : ''}
            {contact.linkedin_url && (
              <a href={contact.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-primary hover:underline ml-2">
                LinkedIn <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {linkedInBadgeState(contact) === 'verified' ? (
              <span
                title="LinkedIn profile confirmed via your connected account"
                className="inline-flex items-center gap-1 ml-2 rounded-full bg-sage-light px-1.5 py-0.5 text-[11px] font-medium text-accent-secondary align-middle"
              >
                <Check className="h-3 w-3" /> Verified
              </span>
            ) : linkedInBadgeState(contact) === 'unverified' ? (
              <span
                title="Not verified yet - this profile link may be out of date. Rescan to check."
                className="ml-2 text-[11px] text-text-tertiary align-middle"
              >
                Unverified
              </span>
            ) : null}
          </p>
          {/* Rescan: force a fresh contact re-pull (e.g. wrong/stale founder). */}
          <Button variant="ghost" size="sm" onClick={() => onResolve(true)} loading={resolveBusy} title="Re-pull the founder contact from source">
            <RefreshCw className="h-3.5 w-3.5" /> Rescan
          </Button>
        </div>
      ) : null}

      {/* Nurture playbook */}
      <section className="space-y-2 border border-border rounded-lg p-3 bg-bg-secondary/40">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs tracking-wide text-text-tertiary flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> Nurture plan
          </p>
          {onPlanNurture && lead.contact_status === 'resolved' && (
            <Button variant="secondary" size="sm" onClick={onPlanNurture} loading={planBusy}>
              {lead.playbook ? 'Regenerate plan' : 'Plan outreach'}
            </Button>
          )}
        </div>
        {lead.playbook ? (
          <PlaybookView playbook={lead.playbook as LeadPlaybook} stage={lead.nurture_stage} due={lead.next_action_at} onToggleStep={onToggleStep} onEditPlan={onEditPlan} />
        ) : (
          <p className="text-xs text-text-tertiary">
            Generate a 4-step plan: research → comment → connect → follow-up DM. Connect note drafts in your voice.
          </p>
        )}

        {/* Sequence follow-up: after the connect is sent, confirm acceptance,
            then draft + approve the DM step. */}
        {lead.nurture_stage === 'connect_sent' && (
          <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-accent-primary/25 bg-accent-primary/5 px-3 py-2">
            <span className="text-xs text-text-secondary flex items-center gap-1.5">
              {accepted && <Check className="h-3.5 w-3.5 text-accent-secondary" />}
              {accepted
                ? 'Connection accepted - send the follow-up DM.'
                : 'Connect sent. Check if they have accepted.'}
            </span>
            {lead.outreach?.channel === 'linkedin_dm' && lead.outreach?.draft_text ? (
              <Button variant="primary" size="sm" onClick={() => onApprove('linkedin_dm')} loading={approveBusy}>
                <Send className="h-4 w-4" /> Approve DM
              </Button>
            ) : accepted && onDraftFollowup ? (
              <Button variant="secondary" size="sm" onClick={onDraftFollowup} loading={followupBusy}>
                <Sparkles className="h-4 w-4" /> Draft follow-up DM
              </Button>
            ) : onCheckConnection ? (
              <Button variant="ghost" size="sm" onClick={onCheckConnection} loading={checkBusy}>
                <RefreshCw className="h-4 w-4" /> Check if accepted
              </Button>
            ) : null}
          </div>
        )}
      </section>

      {/* Conversation thread when the prospect has replied */}
      {inReplyMode && (
        <section className="space-y-2 border border-coral-light rounded-lg p-3 bg-coral-light/20">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs tracking-wide text-coral-dark flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />
              {lead.needs_reply ? 'Needs reply' : 'Conversation'}
            </p>
            {onDraftReply && lead.needs_reply && !draft && (
              <Button variant="secondary" size="sm" onClick={onDraftReply} loading={replyBusy}>
                <Sparkles className="h-4 w-4" /> Draft reply
              </Button>
            )}
          </div>
          {threadLoading ? (
            <p className="text-xs text-text-tertiary">Loading thread…</p>
          ) : threadMessages.length > 0 ? (
            <ul className="space-y-2 max-h-40 overflow-y-auto">
              {threadMessages.map((m) => (
                <li
                  key={m.id}
                  className={`text-sm rounded-md px-2.5 py-2 ${
                    m.direction === 'inbound'
                      ? 'bg-bg-primary border border-border text-text-primary'
                      : 'bg-accent-light/40 text-text-secondary ml-4'
                  }`}
                >
                  <span className="text-[10px] text-text-tertiary block mb-0.5">
                    {m.direction === 'inbound' ? 'Them' : 'You'}
                  </span>
                  {m.body}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-text-tertiary">
              Reply detected - draft a response below. Full thread syncs when Unipile webhooks are configured.
            </p>
          )}
        </section>
      )}

      {inReplyMode && onMarkConversion && (
        <section className="space-y-2 border border-border rounded-lg p-3 bg-bg-secondary/40">
          <p className="text-xs font-mono uppercase tracking-wide text-text-tertiary">Outcome</p>
          <div className="flex flex-wrap gap-2">
            {([
              ['interested', 'Interested'],
              ['meeting_booked', 'Meeting booked'],
              ['not_now', 'Not now'],
              ['lost', 'Lost'],
            ] as const).map(([key, label]) => (
              <Button
                key={key}
                variant={lead.conversion_stage === key ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => onMarkConversion(key)}
              >
                {label}
              </Button>
            ))}
          </div>
        </section>
      )}

      {/* Develop: notes + watch */}
      <section className="space-y-2 border border-border rounded-lg p-3 bg-bg-secondary/40">
        <p className="text-xs tracking-wide text-text-tertiary flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5" /> Develop this lead
        </p>
        <p className="text-xs text-text-tertiary">
          Log next steps - comment ideas, follow-up timing, objections heard.
        </p>
        {notesLoading ? (
          <p className="text-xs text-text-tertiary">Loading notes…</p>
        ) : notes.length > 0 ? (
          <ul className="space-y-1.5 max-h-32 overflow-y-auto">
            {notes.map((n) => (
              <li key={n.id} className="text-sm text-text-secondary border-l-2 border-accent-primary/40 pl-2">
                {n.body}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-text-tertiary italic">No notes yet.</p>
        )}
        <div className="flex gap-2">
          <input
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="e.g. Comment on their launch post Thursday"
            className="flex-1 rounded-md border border-border bg-bg-primary px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
            onKeyDown={(e) => { if (e.key === 'Enter') void addNote(); }}
          />
          <Button variant="secondary" size="sm" onClick={() => void addNote()} disabled={!noteText.trim()}>
            Add
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onFollow} title={followed ? 'Watching this company' : 'Watch for funding/hiring signals'}>
            <Pin className={`h-3.5 w-3.5 ${followed ? 'text-accent-secondary' : ''}`} />
            {followed ? 'Watching' : 'Watch'}
          </Button>
        </div>
      </section>

      {/* Source-fact strip */}
      <blockquote className="text-sm text-text-secondary border-l-2 border-border pl-3 py-1">
        Claim used: {fact.batch ? `joined YC ${fact.batch}` : lead.source}
        {fact.tagline ? ` · "${fact.tagline}"` : ''}
      </blockquote>

      {/* Draft */}
      {draft ? (
        <div className="space-y-1">
          <label className="sr-only" htmlFor="lead-draft">
            {inReplyMode ? 'Reply draft' : 'Outreach draft'}
          </label>
          <textarea
            id="lead-draft"
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            rows={5}
            className="w-full rounded-md border border-border bg-bg-primary p-3 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          />
          <div className={`text-xs text-right ${!inReplyMode && overLimit ? 'text-red-600' : 'text-text-tertiary'}`}>
            {inReplyMode ? `${draft.length} chars` : `${draft.length}/${CONNECT_LIMIT}`}
          </div>
        </div>
      ) : inReplyMode && onDraftReply ? (
        <Button variant="primary" size="sm" onClick={onDraftReply} loading={replyBusy}>
          <Sparkles className="h-4 w-4" /> Draft reply
        </Button>
      ) : (
        <Button variant="primary" size="sm" onClick={() => onDraft()} loading={draftBusy}>
          <Sparkles className="h-4 w-4" /> Draft message
        </Button>
      )}

      {/* Actions */}
      {draft && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {lead.needs_reply && onSendReply ? (
            <Button
              variant="primary"
              size="sm"
              onClick={onSendReply}
              loading={approveBusy}
              disabled={noContact || anyBusy}
            >
              <Send className="h-4 w-4" /> Send reply
            </Button>
          ) : inReplyMode ? null : hasLinkedIn && (
            <Button variant="primary" size="sm" onClick={() => onApprove('linkedin_connect')} loading={approveBusy} disabled={noContact || overLimit || anyBusy}>
              <Send className="h-4 w-4" /> LinkedIn
            </Button>
          )}
          {xHandle && (
            <Button variant="primary" size="sm" onClick={() => onApprove('x_dm')} loading={approveBusy} disabled={noContact || anyBusy}>
              <XLogo className="h-4 w-4" /> X DM
            </Button>
          )}
          {!hasLinkedIn && !xHandle && (
            <Button variant="primary" size="sm" onClick={() => onApprove('linkedin_connect')} loading={approveBusy} disabled={noContact || overLimit || anyBusy}>
              <Send className="h-4 w-4" /> Approve
            </Button>
          )}
          {leadEmail && (
            <Button variant="secondary" size="sm" onClick={onEmail} disabled={anyBusy} title={`Cold email ${leadEmail} (opt-in)`}>
              <Mail className="h-4 w-4" /> Email
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => onDraft()} loading={draftBusy} title="Re-roll a fresh draft">
            <RefreshCw className="h-4 w-4" /> Regenerate
          </Button>
          {onPolish && (
            <Button variant="ghost" size="sm" onClick={onPolish} loading={draftBusy} title="Run the full voice loop for a higher-fidelity rewrite (slower)">
              <Sparkles className="h-4 w-4" /> Polish
            </Button>
          )}
          {onSnooze && (
            <Button variant="ghost" size="sm" onClick={onSnooze} title="Hide until tomorrow's digest">
              <Clock className="h-4 w-4" /> Snooze
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            <X className="h-4 w-4" /> Dismiss
          </Button>
        </div>
      )}

      {/* Rewrite-with-instruction: steer the next generation instead of a blind re-roll. */}
      {draft && (
        <div className="flex items-center gap-2">
          <input
            value={rewriteInstruction}
            onChange={(e) => setRewriteInstruction(e.target.value)}
            placeholder="Tell the model how to change it, e.g. 'shorter, more casual'"
            aria-label="Rewrite instruction"
            className="flex-1 rounded-md border border-border bg-bg-primary px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && rewriteInstruction.trim()) onDraft(rewriteInstruction.trim());
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onDraft(rewriteInstruction.trim() || undefined)}
            loading={draftBusy}
            disabled={!rewriteInstruction.trim()}
          >
            <Sparkles className="h-4 w-4" /> Rewrite
          </Button>
        </div>
      )}
    </div>
  );
}

function PlaybookView({
  playbook,
  stage,
  due,
  onToggleStep,
  onEditPlan,
}: {
  playbook: LeadPlaybook;
  stage?: string | null;
  due?: string | null;
  onToggleStep?: (stepIndex: number, status: 'pending' | 'done') => void;
  onEditPlan?: (edit: { whyThem?: string; angle?: string; stepLabels?: string[] }) => void;
}) {
  const doneCount = playbook.steps.filter((s) => s.status === 'done').length;
  const [editing, setEditing] = useState(false);
  const [whyThem, setWhyThem] = useState(playbook.whyThem);
  const [angle, setAngle] = useState(playbook.angle);
  const [stepLabels, setStepLabels] = useState(playbook.steps.map((s) => s.label));

  // Re-seed the editable copy whenever the underlying plan changes (e.g. after a
  // regenerate), so a stale draft is never shown when the user opens the editor.
  useEffect(() => {
    if (editing) return;
    setWhyThem(playbook.whyThem);
    setAngle(playbook.angle);
    setStepLabels(playbook.steps.map((s) => s.label));
  }, [editing, playbook]);

  if (editing) {
    return (
      <div className="space-y-2 text-sm">
        <label className="block">
          <span className="text-[11px] font-medium tracking-wide text-text-tertiary">Why them</span>
          <textarea
            value={whyThem}
            onChange={(e) => setWhyThem(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-border bg-bg-primary p-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium tracking-wide text-text-tertiary">Angle</span>
          <textarea
            value={angle}
            onChange={(e) => setAngle(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-border bg-bg-primary p-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          />
        </label>
        <div className="space-y-1">
          <span className="text-[11px] font-medium tracking-wide text-text-tertiary">Steps</span>
          {stepLabels.map((label, i) => (
            <input
              key={`edit-step-${i}`}
              value={label}
              onChange={(e) => setStepLabels((prev) => prev.map((l, j) => (j === i ? e.target.value : l)))}
              aria-label={`Step ${i + 1} label`}
              className="w-full rounded-md border border-border bg-bg-primary px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
            />
          ))}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onEditPlan?.({ whyThem: whyThem.trim(), angle: angle.trim(), stepLabels: stepLabels.map((l) => l.trim()) });
              setEditing(false);
            }}
          >
            <Check className="h-4 w-4" /> Save plan
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 text-sm">
      {onEditPlan && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs font-medium text-accent-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary rounded"
          >
            Edit plan
          </button>
        </div>
      )}
      <p className="text-text-secondary">
        <span className="font-medium text-text-primary">Why: </span>
        {playbook.whyThem}
      </p>
      <p className="text-text-secondary">
        <span className="font-medium text-text-primary">Angle: </span>
        {playbook.angle}
      </p>
      {stage && (
        <p className="text-xs text-text-tertiary">
          Stage: {stage.replace(/_/g, ' ')}
          {due ? ` · next action ${new Date(due).toLocaleDateString()}` : ''}
        </p>
      )}
      {playbook.targetPost && (
        <p className="text-xs text-text-tertiary line-clamp-2">
          Target post ({playbook.targetPost.source}): {playbook.targetPost.excerpt}
        </p>
      )}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium tracking-wide text-text-tertiary">Steps</span>
        <span className="text-[11px] text-text-tertiary">{doneCount}/{playbook.steps.length} done</span>
      </div>
      <ul className="space-y-1">
        {playbook.steps.map((s, i) => {
          const done = s.status === 'done';
          return (
            <li key={`${s.type}-${i}`}>
              <button
                type="button"
                disabled={!onToggleStep}
                onClick={() => onToggleStep?.(i, done ? 'pending' : 'done')}
                className="group flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-bg-primary disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    done ? 'border-accent-primary bg-accent-primary text-white' : 'border-border text-transparent group-hover:border-accent-primary/50'
                  }`}
                >
                  <Check className="h-3 w-3" />
                </span>
                <span className={done ? 'text-text-tertiary line-through' : 'text-text-secondary'}>
                  {s.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
