import type { BrainGraph, BrainGraphNode } from './graph';
import type { BrainPageRecord } from './types';

export type BrainDecisionPriority = 'high' | 'medium' | 'low';

export interface BrainDecision {
  id: string;
  priority: BrainDecisionPriority;
  title: string;
  detail: string;
  /** Deep-link for the recommended next step. */
  action?: { label: string; href: string };
  /** Graph node to highlight when the user engages with this decision. */
  nodeId?: string;
}

export interface BrainInsightsSummary {
  /** 0–100: how much of the brain namespace is populated with real learning. */
  coverage: number;
  postCount: number;
  storyCount: number;
  pillarCount: number;
  voiceReady: boolean;
  gtmReady: boolean;
  referencesCount: number;
  topPillarByPerformance: { label: string; views: number } | null;
  weakestPillar: { label: string; postCount: number } | null;
  bestPost: { label: string; views: number } | null;
  decisions: BrainDecision[];
}

function safeParse(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isPendingPage(page: BrainPageRecord | undefined): boolean {
  if (!page?.body?.trim()) return true;
  if (page.body.includes('"status":"pending"') || page.body.includes('"status": "pending"')) return true;
  const parsed = safeParse(page.body);
  return parsed?.status === 'pending';
}

function countSavedReferences(body: string): number {
  if (!body.trim()) return 0;
  const parsed = safeParse(body);
  if (parsed && Array.isArray(parsed.entries)) return parsed.entries.length;
  // Plain-text accumulated hooks - count non-empty paragraphs.
  return body.split(/\n{2,}/).filter((block) => block.trim().length > 20).length;
}

function gtmFieldsFilled(body: string): number {
  const parsed = safeParse(body);
  if (!parsed || parsed.status === 'pending') return 0;
  const fields = ['icp', 'pitch', 'objections', 'proof_points', 'cta_style'] as const;
  return fields.filter((f) => typeof parsed[f] === 'string' && String(parsed[f]).trim().length > 8).length;
}

interface PillarStats {
  id: string;
  label: string;
  postCount: number;
  totalViews: number;
}

/**
 * Derives coverage metrics and actionable decisions from brain pages + graph.
 *
 * Every learning signal (voice, intel, posts, stories, GTM, references) feeds
 * both the visualization weights and a prioritized decision list so the graph
 * is a decision surface, not just a diagram.
 */
export function deriveBrainInsights(
  pages: BrainPageRecord[],
  graph: BrainGraph,
): BrainInsightsSummary {
  const pageBySlug = new Map(pages.map((p) => [p.slug, p]));

  const posts = graph.nodes.filter((n) => n.kind === 'post');
  const stories = graph.nodes.filter((n) => n.kind === 'story');
  const pillars = graph.nodes.filter((n) => n.kind === 'pillar');

  const voicePage = pageBySlug.get('voice');
  const gtmPage = pageBySlug.get('gtm');
  const refsPage = pageBySlug.get('saved-references');
  const backgroundPage = pageBySlug.get('background');
  const linkedinPage = pageBySlug.get('linkedin');

  const voiceBody = voicePage ? safeParse(voicePage.body) : null;
  const voiceReady = Boolean(
    voiceBody &&
      voiceBody.status !== 'pending' &&
      typeof voiceBody.voice_description === 'string' &&
      voiceBody.voice_description.trim().length > 10,
  );

  const gtmReady = gtmFieldsFilled(gtmPage?.body ?? '') >= 3;
  const referencesCount = countSavedReferences(refsPage?.body ?? '');

  // Coverage: weighted checklist of learning surfaces that power generation.
  const coverageChecks = [
    { ok: !isPendingPage(pageBySlug.get('profile')), weight: 15 },
    { ok: voiceReady, weight: 20 },
    { ok: !isPendingPage(linkedinPage) || !isPendingPage(backgroundPage), weight: 10 },
    { ok: posts.length > 0, weight: 20 },
    { ok: pillars.length > 0, weight: 10 },
    { ok: gtmReady, weight: 10 },
    { ok: referencesCount > 0, weight: 5 },
    { ok: stories.length > 0, weight: 5 },
    { ok: posts.some((p) => p.highlight), weight: 5 },
  ];
  const coverage = Math.round(
    coverageChecks.reduce((sum, c) => sum + (c.ok ? c.weight : 0), 0),
  );

  // Per-pillar post count + view totals from graph edges + node meta.
  const pillarStats = new Map<string, PillarStats>();
  for (const pillar of pillars) {
    pillarStats.set(pillar.id, { id: pillar.id, label: pillar.label, postCount: 0, totalViews: 0 });
  }
  for (const edge of graph.edges) {
    const pillarId = pillarStats.has(edge.source)
      ? edge.source
      : pillarStats.has(edge.target)
        ? edge.target
        : null;
    if (!pillarId) continue;
    const postId = edge.source === pillarId ? edge.target : edge.source;
    const postNode = graph.nodes.find((n) => n.id === postId && n.kind === 'post');
    if (!postNode) continue;
    const stats = pillarStats.get(pillarId)!;
    stats.postCount += 1;
    const views = typeof postNode.meta?.views === 'number' ? postNode.meta.views : 0;
    stats.totalViews += views;
  }

  let topPillarByPerformance: { label: string; views: number } | null = null;
  let weakestPillar: { label: string; postCount: number } | null = null;

  for (const stats of Array.from(pillarStats.values())) {
    if (!topPillarByPerformance || stats.totalViews > topPillarByPerformance.views) {
      topPillarByPerformance = { label: stats.label, views: stats.totalViews };
    }
    if (pillars.length > 1 && (!weakestPillar || stats.postCount < weakestPillar.postCount)) {
      weakestPillar = { label: stats.label, postCount: stats.postCount };
    }
  }

  const bestPostNode = posts.reduce<BrainGraphNode | null>((best, n) => {
    if (!best) return n;
    return (n.weight ?? 0) > (best.weight ?? 0) ? n : best;
  }, null);

  const bestPost = bestPostNode
    ? {
        label: bestPostNode.label,
        views: typeof bestPostNode.meta?.views === 'number' ? bestPostNode.meta.views : 0,
      }
    : null;

  const decisions: BrainDecision[] = [];

  if (!voiceReady) {
    decisions.push({
      id: 'voice-missing',
      priority: 'high',
      title: 'Calibrate your voice',
      detail: 'Voice Lab fingerprints how you write. Without it, drafts won\'t sound like you.',
      action: { label: 'Open Voice Lab', href: '/voice-lab' },
      nodeId: 'voice',
    });
  }

  if (pillars.length === 0) {
    decisions.push({
      id: 'pillars-missing',
      priority: 'high',
      title: 'Define content pillars',
      detail: 'Pillars organize what you publish and anchor post memories on the graph.',
      action: { label: 'Edit profile', href: '/settings' },
      nodeId: 'profile',
    });
  }

  if (posts.length === 0) {
    decisions.push({
      id: 'no-posts',
      priority: 'high',
      title: 'Publish posts to build memory',
      detail: 'Published posts become graph nodes sized by performance - the brain learns what resonates.',
      action: { label: 'Go to library', href: '/library' },
    });
  } else if (posts.length < 5) {
    decisions.push({
      id: 'few-posts',
      priority: 'medium',
      title: 'Add more published posts',
      detail: `Only ${posts.length} post${posts.length === 1 ? '' : 's'} in memory. More posts sharpen pillar clusters and win detection.`,
      action: { label: 'Sync brain', href: '/brain' },
    });
  }

  if (weakestPillar && weakestPillar.postCount === 0 && pillars.length > 1) {
    decisions.push({
      id: 'empty-pillar',
      priority: 'medium',
      title: `Create content for "${weakestPillar.label}"`,
      detail: 'This pillar has no published posts yet - a gap in your content mix.',
      action: { label: 'Generate a post', href: '/generate' },
      nodeId: pillars.find((p) => p.label === weakestPillar!.label)?.id,
    });
  }

  if (topPillarByPerformance && topPillarByPerformance.views > 0 && posts.length >= 3) {
    decisions.push({
      id: 'double-down-pillar',
      priority: 'low',
      title: `Double down on "${topPillarByPerformance.label}"`,
      detail: `Your strongest pillar by views (${topPillarByPerformance.views.toLocaleString()} total). Consider more content here.`,
      action: { label: 'Generate in this pillar', href: '/generate' },
      nodeId: pillars.find((p) => p.label === topPillarByPerformance!.label)?.id,
    });
  }

  if (!gtmReady) {
    decisions.push({
      id: 'gtm-incomplete',
      priority: 'medium',
      title: 'Complete your GTM playbook',
      detail: 'ICP, pitch, and objection handling power Signals outreach drafts.',
      action: { label: 'Leads settings', href: '/leads/settings' },
      nodeId: 'gtm',
    });
  }

  if (referencesCount === 0 && posts.length > 0) {
    decisions.push({
      id: 'no-references',
      priority: 'low',
      title: 'Save winning hooks from Analytics',
      detail: 'Saved references connect to your voice node and inform future drafts.',
      action: { label: 'View analytics', href: '/analytics' },
      nodeId: 'saved-references',
    });
  }

  if (stories.length === 0) {
    decisions.push({
      id: 'no-stories',
      priority: 'low',
      title: 'Add stories to your bank',
      detail: 'Personal stories become memory nodes linked to your pillars.',
      action: { label: 'Story bank', href: '/story-bank' },
    });
  }

  if (isPendingPage(backgroundPage) && isPendingPage(linkedinPage)) {
    decisions.push({
      id: 'no-intel',
      priority: 'medium',
      title: 'Run background research',
      detail: 'LinkedIn and web intel enrich your profile hub with expertise and proof points.',
      action: { label: 'Complete onboarding', href: '/onboarding' },
      nodeId: 'background',
    });
  }

  if (bestPost && bestPost.views > 0) {
    const bestNode = posts.find((p) => p.label === bestPost.label);
    decisions.push({
      id: 'study-winner',
      priority: 'low',
      title: 'Study your top performer',
      detail: `"${bestPost.label}" drove ${bestPost.views.toLocaleString()} views - analyze what made it work.`,
      action: { label: 'View in analytics', href: '/analytics' },
      nodeId: bestNode?.id,
    });
  }

  // Sort: high → medium → low.
  const priorityOrder: Record<BrainDecisionPriority, number> = { high: 0, medium: 1, low: 2 };
  decisions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return {
    coverage,
    postCount: posts.length,
    storyCount: stories.length,
    pillarCount: pillars.length,
    voiceReady,
    gtmReady,
    referencesCount,
    topPillarByPerformance,
    weakestPillar,
    bestPost,
    decisions: decisions.slice(0, 6),
  };
}
