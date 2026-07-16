import { describe, it, expect } from 'vitest';
import { extractTopics, buildBrainGraph } from '@/lib/brain/graph';
import type { BrainPageRecord } from '@/lib/brain/types';

describe('extractTopics', () => {
  const posts = [
    { id: 'p1', text: 'Fundraising lessons from my seed round' },
    { id: 'p2', text: 'Fundraising is brutal, here is what I learned' },
    { id: 'p3', text: 'More fundraising tactics for founders' },
    { id: 'p4', text: 'Hiring your first engineer' },
  ];

  it('surfaces a term that recurs across enough posts', () => {
    const topics = extractTopics(posts, new Set(), 3, 6);
    const fundraising = topics.find((t) => t.term === 'fundraising');
    expect(fundraising).toBeDefined();
    expect(fundraising!.postIds.sort()).toEqual(['p1', 'p2', 'p3']);
    expect(fundraising!.label).toBe('Fundraising');
  });

  it('respects the minimum-posts threshold', () => {
    expect(extractTopics(posts, new Set(), 4, 6)).toEqual([]);
  });

  it('excludes pillar-label tokens', () => {
    const topics = extractTopics(posts, new Set(['fundraising']), 3, 6);
    expect(topics.find((t) => t.term === 'fundraising')).toBeUndefined();
  });
});

describe('buildBrainGraph topic nodes', () => {
  function postPage(id: string, title: string, content: string, pillar: string): BrainPageRecord {
    return {
      id,
      user_id: 'u1',
      slug: `post/${id}`,
      title,
      tags: [],
      body: JSON.stringify({ content, pillar, platform: 'linkedin', views: 100 }),
      updated_at: '2026-01-01T00:00:00Z',
    };
  }

  it('adds topic nodes and links the posts that share them', () => {
    const pages: BrainPageRecord[] = [
      {
        id: 'profile',
        user_id: 'u1',
        slug: 'profile',
        title: 'Creator',
        tags: [],
        body: JSON.stringify({ pillars: ['Fundraising', 'Hiring'] }),
        updated_at: '2026-01-01T00:00:00Z',
      },
      postPage('a', 'Fundraising lessons', 'hard lessons about fundraising velocity', 'Fundraising'),
      postPage('b', 'Fundraising velocity', 'more on fundraising velocity and momentum', 'Fundraising'),
      postPage('c', 'Velocity in a raise', 'velocity is everything when you raise', 'Fundraising'),
    ];
    const graph = buildBrainGraph(pages);
    const topicNodes = graph.nodes.filter((n) => n.kind === 'topic');
    // "velocity" recurs across all three posts -> a topic node.
    const velocity = topicNodes.find((n) => n.id === 'topic:velocity');
    expect(velocity).toBeDefined();
    // Posts are linked to the topic (relational cross-links).
    const topicEdges = graph.edges.filter((e) => e.target === 'topic:velocity');
    expect(topicEdges.length).toBe(3);
    expect(topicEdges.map((e) => e.source).sort()).toEqual(['post/a', 'post/b', 'post/c']);
  });
});
