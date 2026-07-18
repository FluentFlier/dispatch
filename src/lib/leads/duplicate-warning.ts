/**
 * Pure helpers for the duplicate-contact warning shown after a 409 from
 * POST /api/leads/:id/approve (Task 10's guard). Kept dependency-free so the
 * 409 -> warning-state mapping and the retry request body are unit-testable
 * without mounting the LeadDetail component.
 */

export interface DuplicateWarningState {
  blockedByDnc: boolean;
  /** ISO timestamp of the prior send, or null if the block is DNC-only. */
  lastAt: string | null;
  /** Channel the prior send went out on. */
  channel: string | null;
}

/** Human label for an outreach channel, matching the toast copy used elsewhere. */
const CHANNEL_LABELS: Record<string, string> = {
  linkedin_connect: 'LinkedIn',
  linkedin_dm: 'LinkedIn DM',
  x_dm: 'X DM',
  gmail: 'email',
};

export function channelLabel(channel: string | null | undefined): string {
  if (!channel) return 'another channel';
  return CHANNEL_LABELS[channel] ?? channel.replace(/_/g, ' ');
}

/** Maps the approve route's 409 JSON body to warning state, or null if it wasn't a duplicate block. */
export function parseDuplicateResponse(data: unknown): DuplicateWarningState | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.duplicate !== true) return null;
  return {
    blockedByDnc: d.blockedByDnc === true,
    lastAt: typeof d.lastAt === 'string' ? d.lastAt : null,
    channel: typeof d.channel === 'string' ? d.channel : null,
  };
}

/** Inline warning copy: "Already contacted <date> via <channel>." or the DNC variant. */
export function formatDuplicateWarning(state: DuplicateWarningState): string {
  if (state.blockedByDnc) return 'This contact is on your do-not-contact list.';
  const date = state.lastAt ? new Date(state.lastAt).toLocaleDateString() : 'previously';
  return `Already contacted ${date} via ${channelLabel(state.channel)}.`;
}

export interface ApproveRequestBody {
  channel: string;
  messageText?: string;
  emailOptIn?: boolean;
  overrideDuplicate?: boolean;
}

/** Builds the /api/leads/:id/approve POST body. Retry passes overrideDuplicate: true. */
export function buildApproveBody(
  channel: string,
  messageText: string | undefined,
  opts: { emailOptIn?: boolean; overrideDuplicate?: boolean } = {},
): ApproveRequestBody {
  return {
    channel,
    messageText,
    emailOptIn: opts.emailOptIn,
    overrideDuplicate: opts.overrideDuplicate,
  };
}
