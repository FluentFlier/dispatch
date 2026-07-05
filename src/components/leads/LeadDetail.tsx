'use client';

import { useState } from 'react';
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
  Twitter,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { SignalLeadWithContacts } from '@/lib/signals/types';
import type { YcCompanyDetail } from '@/lib/signals/ingest/yc-algolia';

/** LinkedIn connect-note character ceiling; drafts over this can't be approved. */
export const CONNECT_LIMIT = 300;

/** Short "YC · W24" / "PH" style source tag for a directory lead. */
export function sourceTag(lead: SignalLeadWithContacts): string {
  const src = lead.source === 'product_hunt' ? 'PH' : 'YC';
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
      <p className="text-xs font-mono uppercase tracking-wide text-text-tertiary mb-1">About</p>
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
  company: YcCompanyDetail | 'loading' | undefined;
  draft: string;
  onDraftChange: (v: string) => void;
  busy: boolean;
  followed: boolean;
  onDraft: () => void;
  onApprove: () => void;
  onEmail: () => void;
  onDismiss: () => void;
  onResolve: (force?: boolean) => void;
  onFollow: () => void;
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
  draft,
  onDraftChange,
  busy,
  followed,
  onDraft,
  onApprove,
  onEmail,
  onDismiss,
  onResolve,
  onFollow,
}: LeadDetailProps) {
  const contact = lead.primary_contact;
  const noContact = lead.contact_status === 'no_contact';
  const leadEmail = lead.contacts?.find((c) => c.email)?.email ?? null;
  const overLimit = draft.length > CONNECT_LIMIT;
  const fact = lead.source_fact as { batch?: string; tagline?: string };

  const detail = company && company !== 'loading' ? company : null;
  const loadingCompany = company === 'loading';
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
            <p className="text-xs font-mono uppercase tracking-wide text-text-tertiary">{sourceTag(lead)}</p>
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
      {loadingCompany && !detail ? (
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
              {ycUrl && <IconLink href={ycUrl} title="YC page"><ExternalLink className="h-4 w-4" /></IconLink>}
              {(detail?.linkedinUrl || contact?.linkedin_url) && (
                <IconLink href={(detail?.linkedinUrl || contact?.linkedin_url)!} title="LinkedIn"><Linkedin className="h-4 w-4" /></IconLink>
              )}
              {detail?.twitterUrl && <IconLink href={detail.twitterUrl} title="X / Twitter"><Twitter className="h-4 w-4" /></IconLink>}
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
          <Button variant="ghost" size="sm" onClick={() => onResolve(false)} loading={busy}>Try to resolve</Button>
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
          </p>
          {/* Rescan: force a fresh contact re-pull (e.g. wrong/stale founder). */}
          <Button variant="ghost" size="sm" onClick={() => onResolve(true)} loading={busy} title="Re-pull the founder contact from source">
            <RefreshCw className="h-3.5 w-3.5" /> Rescan
          </Button>
        </div>
      ) : null}

      {/* Source-fact strip */}
      <blockquote className="text-sm text-text-secondary border-l-2 border-border pl-3 py-1">
        Claim used: {fact.batch ? `joined YC ${fact.batch}` : lead.source}
        {fact.tagline ? ` · "${fact.tagline}"` : ''}
      </blockquote>

      {/* Draft */}
      {draft ? (
        <div className="space-y-1">
          <label className="sr-only" htmlFor="lead-draft">Outreach draft</label>
          <textarea
            id="lead-draft"
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            rows={5}
            className="w-full rounded-md border border-border bg-bg-primary p-3 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          />
          <div className={`text-xs text-right ${overLimit ? 'text-red-600' : 'text-text-tertiary'}`}>
            {draft.length}/{CONNECT_LIMIT}
          </div>
        </div>
      ) : (
        <Button variant="primary" size="sm" onClick={onDraft} loading={busy}>
          <Sparkles className="h-4 w-4" /> Draft message
        </Button>
      )}

      {/* Actions */}
      {draft && (
        <div className="flex items-center gap-2 pt-1">
          <Button variant="primary" size="sm" onClick={onApprove} disabled={noContact || overLimit || busy}>
            <Send className="h-4 w-4" /> Approve
          </Button>
          {leadEmail && (
            <Button variant="secondary" size="sm" onClick={onEmail} disabled={busy} title={`Cold email ${leadEmail} (opt-in)`}>
              <Mail className="h-4 w-4" /> Email
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onDraft} loading={busy}>
            <RefreshCw className="h-4 w-4" /> Regenerate
          </Button>
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            <X className="h-4 w-4" /> Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}
