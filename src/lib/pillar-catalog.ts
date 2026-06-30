import { loadHookDataset } from '@/lib/hooks-intelligence';

/**
 * Pillar catalog: suggestions users can add to their own pillar set. Their
 * voice-generated pillars are always the default; this just gives optional,
 * non-locking choices (curated common pillars + data-driven trending ones).
 */

export interface PillarSuggestion {
  /** Slug (kebab-case of name) used as the pillar value. */
  slug: string;
  name: string;
  description: string;
  tag: 'suggested' | 'trending';
}

export function pillarSlug(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '-');
}

/** Hand-picked common creator pillars. Static, always available. */
const CURATED: Array<{ name: string; description: string }> = [
  { name: 'Hot Take', description: 'A sharp, contrarian opinion on your space' },
  { name: 'Build in Public', description: 'Share progress, metrics, and decisions as you build' },
  { name: 'Career Growth', description: 'Lessons on leveling up, interviews, and promotions' },
  { name: 'Tutorials', description: 'Step-by-step how-tos and walkthroughs' },
  { name: 'Personal Story', description: 'A real moment that shaped how you think' },
  { name: 'Industry News', description: 'Your take on what just happened in your field' },
  { name: 'Behind the Scenes', description: 'How the work actually gets done' },
  { name: 'Lessons Learned', description: 'What a project or failure taught you' },
  { name: 'Myth Busting', description: 'Correct a common misconception in your niche' },
  { name: 'Case Study', description: 'Break down a specific result and how you got it' },
  { name: 'Productivity', description: 'Systems, habits, and workflows that work' },
  { name: 'Tools & Stack', description: 'The tools you use and why' },
  { name: 'Founder Journey', description: 'The reality of building a company or product' },
  { name: 'Product Updates', description: 'What you shipped and why it matters' },
  { name: 'Trends & Predictions', description: 'Where your space is heading' },
  { name: 'Contrarian Opinion', description: 'Challenge the consensus with a reason' },
  { name: 'Day in the Life', description: 'A window into your routine and process' },
  { name: 'Wins & Milestones', description: 'Celebrate a concrete achievement' },
  { name: 'Failures & Setbacks', description: 'What went wrong and what you changed' },
  { name: 'Frameworks', description: 'A repeatable mental model others can steal' },
  { name: 'Resources', description: 'Curated links, books, and references worth sharing' },
  { name: 'Q&A', description: 'Answer a real question from your audience' },
  { name: 'Hiring & Team', description: 'Building, leading, and working with people' },
  { name: 'AI & Automation', description: 'How you use AI in real work' },
  { name: 'Community', description: 'Spotlight people and conversations in your space' },
];

/** Friendly labels for the Hook Intelligence verticals used for trending. */
const VERTICAL_PILLARS: Record<string, { name: string; description: string }> = {
  ai: { name: 'AI', description: 'Building and using AI in the real world' },
  tech: { name: 'Tech', description: 'Engineering, products, and the industry' },
  copywriting: { name: 'Copywriting', description: 'Words that convert' },
  audience_building: { name: 'Audience Building', description: 'Growing a following that compounds' },
  indie_maker: { name: 'Indie Maker', description: 'Shipping small products solo' },
  one_person_business: { name: 'One-Person Business', description: 'Solo, leveraged, profitable' },
  founder_story: { name: 'Founder Story', description: 'The real founder journey' },
  product_launch: { name: 'Product Launch', description: 'Shipping and announcing' },
  customer_story: { name: 'Customer Story', description: 'Real results from real users' },
  thread_systems: { name: 'Threads & Systems', description: 'High-performing thread structures' },
  mindset: { name: 'Mindset', description: 'How you think about the work' },
  visual_design: { name: 'Visual Design', description: 'Design that gets noticed' },
  direct_response: { name: 'Direct Response', description: 'Posts engineered to drive action' },
  hot_take: { name: 'Hot Take', description: 'A sharp, contrarian opinion' },
};

export const CURATED_PILLARS: PillarSuggestion[] = CURATED.map((p) => ({
  slug: pillarSlug(p.name),
  name: p.name,
  description: p.description,
  tag: 'suggested',
}));

/**
 * Data-driven trending pillars: counts Hook Intelligence verticals across the
 * mined dataset and returns the most common ones mapped to friendly pillars.
 * Server-only (reads the bundled hook dataset).
 */
export function getTrendingPillars(limit = 6): PillarSuggestion[] {
  try {
    const dataset = loadHookDataset();
    const counts = new Map<string, number>();
    for (const hook of dataset.hooks) {
      for (const v of hook.verticals ?? []) {
        if (v === 'general') continue;
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([vertical]) => VERTICAL_PILLARS[vertical])
      .filter((p): p is { name: string; description: string } => Boolean(p))
      .slice(0, limit)
      .map((p) => ({ slug: pillarSlug(p.name), name: p.name, description: p.description, tag: 'trending' as const }));
  } catch {
    return [];
  }
}
