import { describe, it, expect } from 'vitest';
import { deriveContentLearnings, type LearningPost } from '@/lib/brain/learnings';
import type { BrainGraph, BrainGraphNode } from '@/lib/brain/graph';

function post(over: Partial<LearningPost> & { id: string }): LearningPost {
  return {
    pillar: null,
    platform: null,
    views: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    follows_gained: null,
    voice_match_score: null,
    posted_date: null,
    ...over,
  };
}

function graphWith(nodes: Array<Pick<BrainGraphNode, 'id' | 'label' | 'kind'>>): BrainGraph {
  return { nodes: nodes as BrainGraphNode[], edges: [] };
}

describe('deriveContentLearnings', () => {
  it('returns nothing when there is too little data', () => {
    expect(deriveContentLearnings([], graphWith([]))).toEqual([]);
    const few = [post({ id: '1', views: 100 }), post({ id: '2', views: 200 }), post({ id: '3', views: 150 })];
    expect(deriveContentLearnings(few, graphWith([]))).toEqual([]);
  });

  it('surfaces a strong and a weak pillar with graph node ids', () => {
    const posts = [
      post({ id: 'a1', pillar: 'Alpha', views: 1000 }),
      post({ id: 'a2', pillar: 'Alpha', views: 1200 }),
      post({ id: 'a3', pillar: 'Alpha', views: 1100 }),
      post({ id: 'b1', pillar: 'Beta', views: 100 }),
      post({ id: 'b2', pillar: 'Beta', views: 120 }),
      post({ id: 'b3', pillar: 'Beta', views: 110 }),
    ];
    const graph = graphWith([
      { id: 'pillar:alpha', label: 'Alpha', kind: 'pillar' },
      { id: 'pillar:beta', label: 'Beta', kind: 'pillar' },
      { id: 'post/a1', label: 'a1', kind: 'post' },
      { id: 'post/b1', label: 'b1', kind: 'post' },
    ]);

    const learnings = deriveContentLearnings(posts, graph);
    const strong = learnings.find((l) => l.id === 'pillar-strong');
    const weak = learnings.find((l) => l.id === 'pillar-weak');

    expect(strong).toBeDefined();
    expect(strong!.headline).toContain('Alpha');
    expect(strong!.sentiment).toBe('positive');
    expect(strong!.confidence).toBe('low'); // only 3 posts in the group
    expect(strong!.nodeIds).toContain('pillar:alpha');
    expect(strong!.nodeIds).toContain('post/a1');
    // Node ids not present in the graph are filtered out.
    expect(strong!.nodeIds).not.toContain('post/a2');

    expect(weak).toBeDefined();
    expect(weak!.headline).toContain('Beta');
    expect(weak!.sentiment).toBe('watch');
    // Positive learnings are ranked ahead of watch ones.
    expect(learnings.findIndex((l) => l.id === 'pillar-strong')).toBeLessThan(
      learnings.findIndex((l) => l.id === 'pillar-weak'),
    );
  });

  it('flags when voice-match tracks (or fails to track) real performance', () => {
    const rising = [50, 60, 70, 80, 90].map((v, i) =>
      post({ id: `p${i}`, voice_match_score: v, views: v * 10 }),
    );
    const good = deriveContentLearnings(rising, graphWith([]));
    const voiceGood = good.find((l) => l.id === 'voice-reality');
    expect(voiceGood).toBeDefined();
    expect(voiceGood!.sentiment).toBe('positive');

    const inverted = [50, 60, 70, 80, 90].map((v, i) =>
      post({ id: `q${i}`, voice_match_score: v, views: (100 - v) * 10 }),
    );
    const bad = deriveContentLearnings(inverted, graphWith([]));
    const voiceBad = bad.find((l) => l.id === 'voice-reality');
    expect(voiceBad).toBeDefined();
    expect(voiceBad!.sentiment).toBe('watch');
  });

  it('marks a pillar learning high-confidence once the sample is large enough', () => {
    const alpha = Array.from({ length: 5 }, (_, i) => post({ id: `a${i}`, pillar: 'Alpha', views: 1000 + i }));
    const beta = Array.from({ length: 5 }, (_, i) => post({ id: `b${i}`, pillar: 'Beta', views: 100 + i }));
    const learnings = deriveContentLearnings([...alpha, ...beta], graphWith([]));
    const strong = learnings.find((l) => l.id === 'pillar-strong');
    expect(strong?.confidence).toBe('high');
    expect(strong?.sampleSize).toBe(5);
  });
});
