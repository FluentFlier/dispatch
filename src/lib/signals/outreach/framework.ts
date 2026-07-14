/**
 * Outreach relationship framework.
 *
 * Distilled from four reach-out templates (stranger -> weak tie -> alumni/former
 * company -> former colleague). The transferable PRINCIPLES, not the literal
 * referral copy: calibrate warmth to how well you know them, hand them
 * everything so the effort is near-zero, offer an easy out to remove pressure,
 * and acknowledge hesitation to build trust. The creator's own voice is applied
 * by the pipeline on top of this; these lines only shape structure and stance.
 */

export type RelationshipTier = 'former_colleague' | 'alumni' | 'weak_tie' | 'stranger';

export interface RelationshipSignals {
  /** Shared a workplace (any overlap), even briefly. */
  sharedWorkplace?: boolean;
  /** Same school or a former company in common. */
  sharedAlumni?: boolean;
  /** Connected / mutually engaged with content but never actually spoke. */
  connectedNeverSpoke?: boolean;
}

/**
 * Best-effort tier from whatever relationship signal is known. Cold directory
 * leads have none of these, so they resolve to 'stranger' - the correct default
 * (brief, low-pressure, make it easy). Callers that DO know a relationship
 * (warm intros, connection-accepted leads) pass the matching signal.
 */
export function detectRelationshipTier(signals: RelationshipSignals): RelationshipTier {
  if (signals.sharedWorkplace) return 'former_colleague';
  if (signals.sharedAlumni) return 'alumni';
  if (signals.connectedNeverSpoke) return 'weak_tie';
  return 'stranger';
}

const SHARED_PRINCIPLES = [
  'Open with something specific and true about THEM or what they build - never generic praise.',
  'Give them everything they need to say yes with near-zero effort; never make them chase context.',
  'End with a light, specific ask and an easy out (an alternative or a genuine "no pressure"), so a yes feels low-stakes.',
];

const TIER_STANCE: Record<RelationshipTier, string> = {
  former_colleague:
    'You have actually worked together, so warmth can come first. Be direct and familiar, reference the shared work plainly, and ask straight - this is your highest-trust, highest-conversion relationship.',
  alumni:
    'You share a school or former company. Lead with that connection as natural social proof (a same-team ask, not a cold one), and signal you are treating them as an insider, not a transaction.',
  weak_tie:
    'You are connected but have never actually spoken. Be upfront about that, do not overclaim closeness, and acknowledge any hesitation ("this matters, only if it feels right") to build trust before the ask.',
  stranger:
    'No prior contact. Keep it short and make it effortless, be transparent that you have not met, lead with a concrete reason you are reaching out to THEM specifically, and lower the stakes with a genuine easy out.',
};

/**
 * A compact principle block for the outreach prompt, tuned to the relationship
 * tier. Injected into the lead/reply prompt; the creator's voice is layered by
 * the pipeline afterward.
 */
export function outreachFrameworkBlock(tier: RelationshipTier): string {
  return [
    `RELATIONSHIP: ${tier.replace('_', ' ')}.`,
    TIER_STANCE[tier],
    'OUTREACH PRINCIPLES:',
    ...SHARED_PRINCIPLES.map((p) => `- ${p}`),
  ].join('\n');
}
