import { describe, expect, it } from 'vitest';
import { buildBrainGraph } from '@/lib/brain/graph';
import { deriveBrainInsights } from '@/lib/brain/insights';
import type { BrainPageRecord } from '@/lib/brain/types';

function page(slug: string, body: Record<string, unknown> | string, title?: string): BrainPageRecord {
  return {
    id: slug,
    user_id: 'u1',
    slug,
    title: title ?? slug,
    tags: [],
    body: typeof body === 'string' ? body : JSON.stringify(body),
    updated_at: new Date().toISOString(),
  };
}

describe('buildBrainGraph learning signals', () => {
  it('weights posts by performance and marks wins', () => {
    const pages: BrainPageRecord[] = [
      page('profile', { display_name: 'Alex', content_pillars: ['growth'] }),
      page('wins', { top_posts: [{ post_id: 'a' }] }),
      page('post/a', {
        platform: 'linkedin',
        pillar: 'growth',
        content: 'Big win post',
        views: 10000,
        likes: 200,
      }),
      page('post/b', {
        platform: 'linkedin',
        pillar: 'growth',
        content: 'Smaller post',
        views: 100,
        likes: 5,
      }),
    ];

    const graph = buildBrainGraph(pages);
    const postA = graph.nodes.find((n) => n.id === 'post/a');
    const postB = graph.nodes.find((n) => n.id === 'post/b');
    const pillar = graph.nodes.find((n) => n.kind === 'pillar');

    expect(postA?.weight).toBeGreaterThan(postB?.weight ?? 0);
    expect(postA?.highlight).toBe(true);
    expect(pillar?.weight).toBeGreaterThan(0);
    expect(graph.edges.some((e) => e.kind === 'win' && e.target === 'post/a')).toBe(true);
  });

  it('marks pending voice and links background to voice', () => {
    const pages: BrainPageRecord[] = [
      page('profile', { display_name: 'Alex', content_pillars: [] }),
      page('voice', { status: 'pending' }),
      page('background', { bioSummary: 'Founder', topics: ['saas', 'gtm'] }),
    ];

    const graph = buildBrainGraph(pages);
    const voice = graph.nodes.find((n) => n.id === 'voice');
    expect(voice?.pending).toBe(true);
    expect(
      graph.edges.some(
        (e) =>
          (e.source === 'background' && e.target === 'voice') ||
          (e.source === 'voice' && e.target === 'background'),
      ),
    ).toBe(true);
  });

  it('clusters stories under matching pillar by category', () => {
    const pages: BrainPageRecord[] = [
      page('profile', { display_name: 'Alex', content_pillars: ['founder-stories'] }),
      page(
        'story/s1',
        { content: 'My first hire', category: 'founder-stories', tags: [] },
        'First hire',
      ),
    ];

    const graph = buildBrainGraph(pages);
    expect(
      graph.edges.some(
        (e) => e.source === 'pillar:founder-stories' && e.target === 'story/s1',
      ),
    ).toBe(true);
  });
});

describe('deriveBrainInsights decisions', () => {
  it('surfaces high-priority gaps when voice is missing', () => {
    const pages: BrainPageRecord[] = [
      page('profile', { display_name: 'Alex', content_pillars: ['growth'] }),
      page('voice', { status: 'pending' }),
    ];
    const graph = buildBrainGraph(pages);
    const insights = deriveBrainInsights(pages, graph);

    expect(insights.coverage).toBeLessThan(50);
    expect(insights.decisions.some((d) => d.id === 'voice-missing')).toBe(true);
    expect(insights.decisions[0]?.priority).toBe('high');
  });

  it('recommends doubling down on top pillar when enough posts exist', () => {
    const pages: BrainPageRecord[] = [
      page('profile', {
        display_name: 'Alex',
        content_pillars: ['growth', 'product'],
      }),
      page('voice', { voice_description: 'Direct and practical', voice_rules: 'No fluff' }),
      page('post/1', { platform: 'linkedin', pillar: 'growth', content: 'a', views: 5000 }),
      page('post/2', { platform: 'linkedin', pillar: 'growth', content: 'b', views: 3000 }),
      page('post/3', { platform: 'linkedin', pillar: 'product', content: 'c', views: 50 }),
    ];
    const graph = buildBrainGraph(pages);
    const insights = deriveBrainInsights(pages, graph);

    expect(insights.topPillarByPerformance?.label).toBeTruthy();
    expect(insights.decisions.some((d) => d.id === 'double-down-pillar')).toBe(true);
  });
});
