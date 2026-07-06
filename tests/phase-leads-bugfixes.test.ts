import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/llm', () => ({
  chatCompletion: vi.fn(),
}));
import { chatCompletion } from '@/lib/llm';
import { classifyPostHybridWithMeta } from '@/lib/signals/detect/hybrid';
import { normalizeEvent } from '@/lib/signals/feed/normalize';
import type { IngestedPost, SignalEventWithPost } from '@/lib/signals/types';

const post = (content: string): IngestedPost => ({
  platform: 'x',
  externalPostId: '1',
  authorName: 'Jane Doe',
  authorHandle: '@jane',
  content,
});

/**
 * Builds a minimal SignalEventWithPost fixture. Only the fields relevant to
 * the headline fallback are provided by the caller; the rest are stubbed
 * with harmless defaults so each test can focus on the fallback chain.
 */
function makeEvent(overrides: Partial<SignalEventWithPost>): SignalEventWithPost {
  return {
    id: 'evt-1',
    workspace_id: 'ws-1',
    raw_post_id: null,
    signal_type: 'other',
    company_name: null,
    person_name: null,
    accelerator_name: null,
    batch: null,
    signal_summary: null,
    confidence: 0,
    dedupe_key: null,
    status: 'pending',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    raw_post: null,
    outreach: null,
    ...overrides,
  } as SignalEventWithPost;
}

describe('Phase: Leads bugfixes', () => {
  describe('Task 1: signal feed headline never blank/garbage', () => {
    it('falls back to person_name when company_name is null', () => {
      const event = makeEvent({ company_name: null, person_name: 'Jordan Kim' });
      const card = normalizeEvent(event);
      expect(card.companyName).toBe('Jordan Kim');
    });

    it('falls back to raw_post.author_handle (stripping @) when company_name and person_name are null', () => {
      const event = makeEvent({
        company_name: null,
        person_name: null,
        raw_post: {
          id: 'post-1',
          workspace_id: 'ws-1',
          source_id: null,
          platform: 'x',
          external_post_id: 'ext-1',
          author_handle: '@acmehq',
          author_name: null,
          content: 'we joined the accelerator',
          post_url: null,
          posted_at: null,
          raw_payload: null,
          created_at: '2026-07-01T00:00:00.000Z',
        },
      });
      const card = normalizeEvent(event);
      expect(card.companyName).toBe('acmehq');
    });

    it('falls back to "Unknown company" when everything is null', () => {
      const event = makeEvent({ company_name: null, person_name: null, raw_post: null });
      const card = normalizeEvent(event);
      expect(card.companyName).toBe('Unknown company');
    });

    it('keeps company_name unchanged when present', () => {
      const event = makeEvent({ company_name: 'Acme', person_name: 'Jordan Kim' });
      const card = normalizeEvent(event);
      expect(card.companyName).toBe('Acme');
    });
  });

  describe('Task 2: LLM-recover company name when regex extraction fails', () => {
    beforeEach(() => vi.clearAllMocks());

    it('does NOT call the LLM when the keyword hit already has a company', async () => {
      const r = await classifyPostHybridWithMeta(post('I am building Acme, joined YC S24'));
      expect(r.signal?.companyName).toBe('Acme');
      expect(r.escalated).toBe(false);
      expect(chatCompletion).not.toHaveBeenCalled();
    });

    it('recovers the company via the LLM when the keyword hit has no company', async () => {
      vi.mocked(chatCompletion).mockResolvedValue(JSON.stringify({
        is_signal: true, signal_type: 'accelerator_join', company_name: 'Modern Treasury',
      }));
      const r = await classifyPostHybridWithMeta(post('Excited to announce we joined Y Combinator W26!'));
      expect(r.signal?.companyName).toBe('Modern Treasury');
      expect(r.escalated).toBe(true);
      expect(r.signal?.signalType).toBe('accelerator_join');
      expect(chatCompletion).toHaveBeenCalledTimes(1);
    });

    it('keeps the keyword result unchanged (no crash) when the LLM finds no company', async () => {
      vi.mocked(chatCompletion).mockResolvedValue(JSON.stringify({ is_signal: false }));
      const r = await classifyPostHybridWithMeta(post('Excited to announce we joined Y Combinator W26!'));
      expect(r.signal?.companyName).toBeUndefined();
      expect(r.escalated).toBe(true);
      expect(r.signal?.signalType).toBe('accelerator_join');
    });
  });
});
