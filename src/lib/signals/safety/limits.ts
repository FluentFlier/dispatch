import type { OutreachChannel } from '@/lib/signals/types';

/**
 * Conservative defaults aligned with Unipile provider limits documentation.
 * https://developer.unipile.com/docs/provider-limits-and-restrictions
 *
 * We stay well under LinkedIn hard caps (80-100 invites/day, 200/week, 30-50 InMail/day recommended).
 */
export const UNIPILE_SAFETY_REFERENCE = {
  linkedinInvitesPerDayMax: 100,
  linkedinInvitesPerWeekMax: 200,
  linkedinInmailPerDayRecommended: 50,
  linkedinProfileLookupsPerDay: 100,
  /** Unlisted routes (follow, comment, reaction): default ≤100/day; we stay lower. */
  linkedinEngagementActionsPerDay: 100,
  minSecondsBetweenActions: 120,
} as const;

/** Conservative caps for LinkedIn actions without a dedicated settings column. */
export const LINKEDIN_ACTION_CAPS = {
  followsPerDay: 30,
  commentsPerDay: 40,
  profileLookupsPerDay: 80,
} as const;

export interface SignalSafetySettings {
  workspace_id: string;
  outreach_enabled: boolean;
  auto_send_enabled: boolean;
  dry_run: boolean;
  max_linkedin_invites_per_day: number;
  max_linkedin_inmail_per_day: number;
  max_x_dm_per_day: number;
  max_gmail_per_day: number;
  max_linkedin_invites_per_week: number;
  min_seconds_between_sends: number;
  max_jitter_seconds: number;
  min_poll_interval_minutes: number;
  max_sources_per_sync_run: number;
  delay_between_polls_ms: number;
  working_hours_only: boolean;
  working_hours_utc_start: number;
  working_hours_utc_end: number;
}

export const DEFAULT_SAFETY_SETTINGS: Omit<SignalSafetySettings, 'workspace_id'> = {
  outreach_enabled: false,
  auto_send_enabled: false,
  dry_run: true,
  max_linkedin_invites_per_day: 25,
  max_linkedin_inmail_per_day: 15,
  max_x_dm_per_day: 15,
  max_gmail_per_day: 20,
  max_linkedin_invites_per_week: 80,
  min_seconds_between_sends: 180,
  max_jitter_seconds: 120,
  min_poll_interval_minutes: 30,
  max_sources_per_sync_run: 6,
  delay_between_polls_ms: 3_000,
  working_hours_only: true,
  working_hours_utc_start: 14,
  working_hours_utc_end: 22,
};

export type OutreachAuditAction =
  | 'poll_source'
  | 'poll_skipped_interval'
  | 'profile_lookup'
  | 'outreach_send_attempt'
  | 'outreach_send_success'
  | 'outreach_blocked'
  | 'slack_alert_sent'
  | 'slack_alert_failed'
  // Automated action-pipeline outcomes (runSignalActions).
  | 'auto_draft'
  | 'auto_draft_failed'
  | 'auto_send_skipped'
  | 'auto_action_skipped';

export function channelToLimitKey(
  channel: OutreachChannel,
):
  | 'linkedin_invite'
  | 'linkedin_inmail'
  | 'linkedin_follow'
  | 'linkedin_comment'
  | 'x_dm'
  | 'gmail'
  | null {
  switch (channel) {
    case 'linkedin_connect':
      return 'linkedin_invite';
    case 'linkedin_dm':
      return 'linkedin_inmail';
    case 'linkedin_follow':
      return 'linkedin_follow';
    case 'linkedin_comment':
      return 'linkedin_comment';
    case 'x_dm':
      return 'x_dm';
    case 'gmail':
      return 'gmail';
    case 'copy':
      return null;
    default: {
      const _exhaustive: never = channel;
      return _exhaustive;
    }
  }
}

export function isWithinWorkingHours(
  settings: SignalSafetySettings,
  now: Date = new Date(),
): boolean {
  if (!settings.working_hours_only) return true;
  const hour = now.getUTCHours();
  const start = settings.working_hours_utc_start;
  const end = settings.working_hours_utc_end;
  if (start <= end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export function computeRequiredCooldownMs(
  settings: SignalSafetySettings,
  randomFn: () => number = Math.random,
): number {
  const jitterSec = Math.floor(randomFn() * settings.max_jitter_seconds);
  return (settings.min_seconds_between_sends + jitterSec) * 1000;
}
