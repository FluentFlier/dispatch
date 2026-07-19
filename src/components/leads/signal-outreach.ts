/**
 * Pure outreach-channel logic for signal cards.
 *
 * A signal card (a detected X/LinkedIn post) reaches the UI as a
 * `UnifiedLeadCard` whose `contact` may hold a LinkedIn URL, an X handle, an
 * email, or nothing but a name. Before we can draft or send, we must pick the
 * one channel that is actually reachable and derive the target identifier for
 * it. Keeping that decision here (no React, no DOM) makes it unit-testable and
 * keeps `SignalDetail` free of branching send logic.
 */

import type { UnifiedLeadCard } from '@/lib/signals/feed/normalize';
import { linkedInIdentifierFromSignal } from '@/lib/signals/linkedin-identifier';
import { LINKEDIN_CONNECT_NOTE_LIMIT } from '@/lib/leads/constants';

/** LinkedIn connect-note character ceiling; drafts over this can't be sent. */
export const SIGNAL_CONNECT_LIMIT = LINKEDIN_CONNECT_NOTE_LIMIT;

/**
 * The channel a signal draft/send should use. `copy` means "no reachable
 * messaging channel" - the draft can still be generated and copied by hand,
 * but the Send action is disabled because nothing can be delivered via API.
 */
export type SignalSendChannel = 'linkedin_connect' | 'x_dm' | 'gmail' | 'copy';

/** The resolved outreach plan for a signal card: which channel + who to target. */
export interface SignalOutreachPlan {
  /** Chosen channel, in priority order linkedin_connect > x_dm > gmail > copy. */
  channel: SignalSendChannel;
  /** LinkedIn profile URL (linkedin_connect) or X handle (x_dm); undefined otherwise. */
  linkedinIdentifier?: string;
  /** Recipient email for the gmail channel; undefined otherwise. */
  recipientEmail?: string;
  /** True when the plan resolves to a channel that can actually deliver a message. */
  sendable: boolean;
}

/**
 * Resolves the best outreach channel + target for a signal card.
 *
 * Priority mirrors the directory-lead flow's preference for the highest-signal
 * channel: a LinkedIn connection note first (the identifier can come from an
 * explicit `contact.linkedin_url` or be derived from the post author / person
 * name via `linkedInIdentifierFromSignal`), then an X DM, then a cold email,
 * and finally `copy` when the card carries no messaging channel at all. `copy`
 * is not sendable, so the caller disables Send for it rather than showing a
 * dead button.
 */
export function resolveSignalOutreach(card: UnifiedLeadCard): SignalOutreachPlan {
  const contact = card.contact;

  // 1. LinkedIn: an explicit contact URL, else a real author handle parsed from
  //    a LinkedIn post URL. We deliberately do NOT guess a profile from a bare
  //    person name - a guessed slug is not a real, reachable channel (same rule
  //    isReachable enforces), so a name-only contact must fall through to copy.
  const authorHandle = card.source === 'linkedin' ? extractAuthorHandle(card.sourceUrl) : null;
  const linkedinIdentifier =
    contact?.linkedin_url?.trim() ||
    (authorHandle ? linkedInIdentifierFromSignal({ authorHandle }) : '');
  if (linkedinIdentifier) {
    return { channel: 'linkedin_connect', linkedinIdentifier, sendable: true };
  }

  // 2. X DM: an X handle passed through the shared identifier field.
  const xHandle = contact?.x_handle?.trim();
  if (xHandle) {
    return { channel: 'x_dm', linkedinIdentifier: xHandle, sendable: true };
  }

  // 3. Gmail: a resolved email address.
  const email = contact?.email?.trim();
  if (email) {
    return { channel: 'gmail', recipientEmail: email, sendable: true };
  }

  // 4. Nothing reachable: draft-only (copy), Send disabled.
  return { channel: 'copy', sendable: false };
}

/**
 * Pulls a LinkedIn author handle out of a LinkedIn post URL when present, so a
 * LinkedIn signal with no explicit contact URL can still derive a target. Only
 * returns a value for `linkedin.com/in/<slug>` style URLs; a bare post URL
 * yields null (and the caller falls back to the person name).
 */
function extractAuthorHandle(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null;
  const m = sourceUrl.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? m[1] : null;
}

/**
 * Maps a send failure into the inline notice the UI shows when the safety guard
 * blocks a send (dry-run mode, daily cap, working-hours window). That is
 * expected behavior, not a crash, so the caller surfaces it as a neutral notice;
 * any other status is treated as a real error.
 *
 * The two send backends diverge on the code they return for the same block: the
 * signals endpoint uses HTTP 422, the warm-contact (engager) send/send-dm
 * endpoints use 429. Accept both here so every send flow behaves identically -
 * this is the single source of truth for guard-block detection.
 */
export function isGuardBlock(status: number): boolean {
  return status === 422 || status === 429;
}
