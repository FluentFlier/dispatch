/**
 * Agenda layer.
 *
 * An "agenda" is a saved ICP profile plus a goal: what the user is trying to
 * achieve with outreach (land an internship, win banking customers, hire, raise)
 * and the copy/tone rules + daily caps that goal implies. The nurture engine
 * reads a resolved `Agenda` to decide the outreach angle for comments, connect
 * notes, and DMs so the SAME sequence serves very different goals in the user's
 * own voice.
 */
import type { AgendaGoalType, AgendaSource, IcpProfileRow } from '@/lib/signals/types';

export interface Agenda {
  profileId: string | null;
  name: string;
  goalType: AgendaGoalType;
  description: string | null;
  personas: string[];
  /** One-line outreach angle. Falls back to a goal-appropriate default. */
  pitchAngle: string;
  /** Extra tone rules layered on top of the creator voice. */
  toneRules: string | null;
  keywords: string[];
  verticals: string[];
  dailyConnectLimit: number;
  dailyCommentLimit: number;
  sources: AgendaSource[];
}

/** Human label for a goal type (UI + prompts). */
export function goalLabel(goal: AgendaGoalType): string {
  switch (goal) {
    case 'networking':
      return 'Networking';
    case 'customer_acquisition':
      return 'Customer acquisition';
    case 'hiring':
      return 'Hiring';
    case 'fundraising':
      return 'Fundraising';
    case 'other':
      return 'General outreach';
    default: {
      const _exhaustive: never = goal;
      return _exhaustive;
    }
  }
}

/**
 * The default outreach angle for a goal when the user hasn't written their own.
 * Deliberately peer-to-peer and low-pressure — the nurture drafters turn this
 * into voice-matched copy, so it must never read like a sales pitch.
 */
export function defaultPitchAngle(goal: AgendaGoalType): string {
  switch (goal) {
    case 'networking':
      return 'Reach out as a curious peer who values their work and wants to learn, not sell. Ask for perspective, not a favor.';
    case 'customer_acquisition':
      return 'Show up as a helpful peer in their space who gets their stage. Lead with a relevant observation, never a product pitch.';
    case 'hiring':
      return 'Reach out as someone building a team who admires their work. Be honest about the opportunity, no pressure.';
    case 'fundraising':
      return 'Connect founder-to-investor with genuine context on why their thesis fits. Concrete, humble, specific.';
    case 'other':
      return 'Reach out as a thoughtful peer. Reference something specific and keep it low-pressure.';
    default: {
      const _exhaustive: never = goal;
      return _exhaustive;
    }
  }
}

function toGoalType(raw: unknown): AgendaGoalType {
  const v = String(raw ?? 'networking');
  if (
    v === 'networking' ||
    v === 'customer_acquisition' ||
    v === 'hiring' ||
    v === 'fundraising' ||
    v === 'other'
  ) {
    return v;
  }
  return 'networking';
}

const VALID_SOURCES: AgendaSource[] = ['engagers', 'directory', 'signals'];

/** Normalizes a stored sources array, defaulting to all three sources. */
export function normalizeSources(raw: unknown): AgendaSource[] {
  if (!Array.isArray(raw)) return [...VALID_SOURCES];
  const out = raw.map(String).filter((s): s is AgendaSource => (VALID_SOURCES as string[]).includes(s));
  return out.length > 0 ? out : [...VALID_SOURCES];
}

/** Resolves a stored ICP profile row into a ready-to-use Agenda. */
export function resolveAgenda(profile: IcpProfileRow): Agenda {
  const goalType = profile.goal_type ?? 'networking';
  return {
    profileId: profile.id,
    name: profile.name,
    goalType,
    description: profile.description,
    personas: profile.target_personas ?? [],
    pitchAngle: profile.pitch_angle?.trim() || defaultPitchAngle(goalType),
    toneRules: profile.tone_rules?.trim() || null,
    keywords: profile.keywords ?? [],
    verticals: profile.verticals ?? [],
    dailyConnectLimit: profile.daily_connect_limit ?? 5,
    dailyCommentLimit: profile.daily_comment_limit ?? 5,
    sources: normalizeSources(profile.sources),
  };
}

/**
 * A neutral fallback agenda for workspaces that have no active ICP profile yet,
 * so the nurture engine still produces sane, low-pressure outreach.
 */
export function defaultAgenda(): Agenda {
  return {
    profileId: null,
    name: 'Default',
    goalType: 'networking',
    description: null,
    personas: [],
    pitchAngle: defaultPitchAngle('networking'),
    toneRules: null,
    keywords: [],
    verticals: [],
    dailyConnectLimit: 5,
    dailyCommentLimit: 5,
    sources: [...VALID_SOURCES],
  };
}
