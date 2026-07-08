/**
 * Platform algorithm knowledge base.
 *
 * WHY: "best time to post" and content guidance should not depend only on a
 * single creator's handful of posts. They should encode what we know about how
 * each platform's ranking system behaves across millions of posts — the
 * industry benchmark / "algorithm prior" — and then let each creator's own
 * results refine it over time.
 *
 * This module is the single source of truth for that knowledge so every part of
 * Content OS (best-time engine, content generation, scheduling suggestions) can
 * import the same data instead of hard-coding scattered heuristics.
 *
 * Sources synthesized (2025-2026): Buffer (4.8M posts), Sprout Social, Hootsuite,
 * SocialPilot best-time studies; LinkedIn 360Brew / LiNR engineering write-ups
 * and Richard van der Blom / Trust Insights algorithm research.
 */

export type InsightPlatform = 'linkedin' | 'twitter' | 'instagram' | 'threads';

/** 0 = Sunday ... 6 = Saturday. */
export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface TimingPrior {
  /** Relative engagement multiplier per weekday (index 0-6). Mean is normalized to 1. */
  weekday: number[];
  /** Relative engagement multiplier per hour of day (index 0-23, local time). Mean normalized to 1. */
  hour: number[];
  /** Human-readable summary of the strongest window for this platform. */
  headline: string;
}

/** An algorithm ranking signal, its relative weight, and the concrete creator action it implies. */
export interface AlgorithmSignal {
  signal: string;
  /** Short relative-weight label, e.g. "5x a like" or "critical". */
  weight: string;
  /** What the creator should do to win this signal. */
  action: string;
}

export interface AlgorithmInsights {
  platform: InsightPlatform;
  /** One-line description of how the ranking system decides distribution. */
  model: string;
  signals: AlgorithmSignal[];
  /** Do's the algorithm rewards. */
  rewards: string[];
  /** Don'ts the algorithm suppresses or penalizes. */
  penalties: string[];
  timing: TimingPrior;
}

function normalizeToMeanOne(values: number[]): number[] {
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / values.length;
  if (mean <= 0) return values.map(() => 1);
  return values.map((v) => v / mean);
}

// --- Raw priors (relative, pre-normalization) -----------------------------
// Values are engagement multipliers where the platform average ≈ 1.

const LINKEDIN_WEEKDAY_RAW = [0.5, 0.8, 1.05, 1.35, 1.2, 1.1, 0.55]; // Sun..Sat, Wed peak
const LINKEDIN_HOUR_RAW = [
  0.2, 0.2, 0.2, 0.2, 0.25, 0.3, // 0-5 overnight
  0.45, 0.6, 0.85, 1.0, 1.2, 1.25, // 6-11 morning ramp
  1.15, 1.1, 1.15, 1.35, 1.5, 1.4, // 12-17 afternoon peak (16:00 strongest)
  1.25, 1.1, 1.0, 0.85, 0.7, 0.4, // 18-23 evening taper
];

const TWITTER_WEEKDAY_RAW = [0.6, 1.05, 1.1, 1.1, 1.05, 0.95, 0.6];
const TWITTER_HOUR_RAW = [
  0.3, 0.25, 0.25, 0.3, 0.4, 0.55, // 0-5
  0.7, 0.9, 1.0, 1.05, 1.05, 1.1, // 6-11
  1.2, 1.2, 1.2, 1.2, 1.15, 1.1, // 12-17 midday-afternoon peak
  1.0, 0.95, 0.95, 0.9, 0.7, 0.5, // 18-23
];

// Consumer-social prior (evenings + lunch) reused for Instagram and Threads.
const CONSUMER_WEEKDAY_RAW = [0.95, 0.95, 1.0, 1.0, 1.05, 1.0, 0.9];
const CONSUMER_HOUR_RAW = [
  0.4, 0.3, 0.3, 0.3, 0.4, 0.5, // 0-5
  0.7, 0.9, 1.0, 1.0, 0.95, 1.05, // 6-11
  1.2, 1.1, 1.0, 1.0, 1.05, 1.15, // 12-17
  1.25, 1.3, 1.35, 1.25, 1.0, 0.7, // 18-23 evening peak
];

const LINKEDIN_INSIGHTS: AlgorithmInsights = {
  platform: 'linkedin',
  model:
    'LinkedIn ranks with 360Brew (a large language model) after LiNR retrieval. It reads the meaning of your post, your profile "topic DNA", and each reader\'s context, then decides distribution from early-engagement quality — not raw like counts.',
  signals: [
    { signal: 'Dwell time (31-60s read)', weight: 'critical', action: 'Open with a strong first line; short paragraphs, specific data, and a document/carousel to hold attention.' },
    { signal: 'Saves', weight: '~5x a like', action: 'Give lasting reference value: frameworks, checklists, templates, numbered playbooks.' },
    { signal: 'Substantive comments (25+ words)', weight: '~15x a like', action: 'End with one specific question; reply to every comment in the first 15-60 minutes.' },
    { signal: 'Golden hour velocity (first 60-90 min)', weight: 'decisive', action: 'Post when your audience is active and be present to reply immediately.' },
    { signal: 'Reposts with commentary', weight: 'high', action: 'Make a point worth re-sharing; take a clear stance.' },
    { signal: 'Topic consistency (90-day DNA)', weight: 'compounding', action: 'Stay in 2-3 topic clusters that match your headline/About for ~90 days.' },
  ],
  rewards: [
    'Native text, documents (carousels/PDFs), and polls that keep people on-platform.',
    'A clear point of view and specific, concrete detail (numbers, names, moments).',
    'Consistency in a narrow set of professional topics.',
    'Fast author replies that build thread depth in the golden hour.',
  ],
  penalties: [
    'Outbound links in the post body (put links in the first comment instead).',
    'Engagement-pod behavior and generic "great post!" comments.',
    'Excessive hashtags (keep to 3-5 relevant tags).',
    'Sporadic posting or jumping between unrelated topics (fragments topic DNA).',
    'Editing within minutes of posting or rapid re-posting.',
  ],
  timing: {
    weekday: normalizeToMeanOne(LINKEDIN_WEEKDAY_RAW),
    hour: normalizeToMeanOne(LINKEDIN_HOUR_RAW),
    headline: 'Tue-Thu late morning (10am-12pm) and mid-afternoon (3-5pm); Wednesday ~4pm is the single strongest slot. Weekends are weakest.',
  },
};

const TWITTER_INSIGHTS: AlgorithmInsights = {
  platform: 'twitter',
  model:
    'X ranks for real-time relevance and reply velocity. Early replies, reposts, and bookmarks in the first ~30 minutes drive distribution; outbound links and long dead threads dampen reach.',
  signals: [
    { signal: 'Replies + conversation velocity', weight: 'critical', action: 'Ask something reply-worthy; respond quickly to keep the thread alive.' },
    { signal: 'Reposts / quotes', weight: 'high', action: 'Say something worth re-sharing or arguing with.' },
    { signal: 'Bookmarks', weight: 'high', action: 'Pack a useful, save-worthy insight into the first post.' },
    { signal: 'Dwell / profile clicks', weight: 'medium', action: 'Hook hard in the first line; thread only when depth earns it.' },
  ],
  rewards: [
    'Native content and threads that keep users reading in-app.',
    'Timely takes tied to what people are already discussing.',
    'Strong, opinionated first lines.',
  ],
  penalties: [
    'Outbound links in the first post (reach penalty — put them in a reply).',
    'Hashtag spam.',
    'Low early engagement rate (kills further distribution).',
  ],
  timing: {
    weekday: normalizeToMeanOne(TWITTER_WEEKDAY_RAW),
    hour: normalizeToMeanOne(TWITTER_HOUR_RAW),
    headline: 'Tue-Thu, midday to late afternoon (12-6pm) is strongest; weekends and early mornings are weakest.',
  },
};

const INSTAGRAM_INSIGHTS: AlgorithmInsights = {
  platform: 'instagram',
  model:
    'Instagram ranks on watch time, saves, shares (sends), and completion. It favors content people watch to the end and send to friends.',
  signals: [
    { signal: 'Sends / shares in DMs', weight: 'critical', action: 'Make content worth sending to a specific friend.' },
    { signal: 'Saves', weight: 'high', action: 'Deliver reference value people want to revisit.' },
    { signal: 'Watch time / completion', weight: 'high', action: 'Hook in the first 3 seconds; keep Reels tight.' },
  ],
  rewards: ['Reels with strong hooks and full watch-through.', 'Save- and share-worthy value.', 'Consistent posting cadence.'],
  penalties: ['Low-effort reposts with visible watermarks.', 'Weak first 3 seconds (drop-off).'],
  timing: {
    weekday: normalizeToMeanOne(CONSUMER_WEEKDAY_RAW),
    hour: normalizeToMeanOne(CONSUMER_HOUR_RAW),
    headline: 'Weekday lunchtime and evenings (6-9pm) perform best for reach.',
  },
};

const THREADS_INSIGHTS: AlgorithmInsights = {
  platform: 'threads',
  model:
    'Threads favors conversational replies and recency, surfacing content from both your network and interest graph. Reply velocity and follow-on discussion drive reach.',
  signals: [
    { signal: 'Replies', weight: 'critical', action: 'Post conversational takes that invite responses.' },
    { signal: 'Reposts', weight: 'high', action: 'Share opinions people want to amplify.' },
    { signal: 'Recency', weight: 'medium', action: 'Post when your audience is online and engage back quickly.' },
  ],
  rewards: ['Looser, conversational tone.', 'Timely opinions and questions.'],
  penalties: ['Corporate polish that suppresses replies.', 'Link-only posts.'],
  timing: {
    weekday: normalizeToMeanOne(CONSUMER_WEEKDAY_RAW),
    hour: normalizeToMeanOne(CONSUMER_HOUR_RAW),
    headline: 'Weekday evenings skew strongest; conversational posts beat announcements.',
  },
};

const INSIGHTS_BY_PLATFORM: Record<InsightPlatform, AlgorithmInsights> = {
  linkedin: LINKEDIN_INSIGHTS,
  twitter: TWITTER_INSIGHTS,
  instagram: INSTAGRAM_INSIGHTS,
  threads: THREADS_INSIGHTS,
};

export function normalizeInsightPlatform(value: string | null | undefined): InsightPlatform {
  switch (value) {
    case 'linkedin':
    case 'twitter':
    case 'instagram':
    case 'threads':
      return value;
    case 'x':
      return 'twitter';
    default:
      return 'linkedin';
  }
}

/** Full algorithm knowledge for a platform (defaults to LinkedIn). */
export function getAlgorithmInsights(platform: string | null | undefined): AlgorithmInsights {
  return INSIGHTS_BY_PLATFORM[normalizeInsightPlatform(platform)];
}

/** Timing prior (weekday + hour multipliers) for a platform. */
export function getTimingPrior(platform: string | null | undefined): TimingPrior {
  return getAlgorithmInsights(platform).timing;
}

/**
 * Compact algorithm guidance block for LLM system prompts, so generated content
 * is written to satisfy how the platform actually ranks (dwell time, saves,
 * comments, golden hour), not just to read well.
 */
export function buildAlgorithmComposeGuidance(platform: string | null | undefined): string {
  const insights = getAlgorithmInsights(platform);
  const label = insights.platform.toUpperCase();
  const signalLines = insights.signals
    .map((s) => `- ${s.signal} (${s.weight}): ${s.action}`)
    .join('\n');
  const avoidLines = insights.penalties.map((p) => `- ${p}`).join('\n');
  return `${label} ALGORITHM AWARENESS (write to rank, not just to read)
${insights.model}

Optimize for these ranking signals:
${signalLines}

Avoid (suppresses reach):
${avoidLines}`;
}
