import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/llm', () => ({
  chatCompletion: vi.fn(),
}));
import { chatCompletion } from '@/lib/llm';
import { confirmSignalWithLLM } from '@/lib/signals/detect/llm-confirm';
import { classifyPostHybrid, classifyPostHybridWithMeta } from '@/lib/signals/detect/hybrid';
import type { IngestedPost } from '@/lib/signals/types';

const post = (content: string): IngestedPost => ({
  platform: 'x',
  externalPostId: '1',
  authorName: 'Jane Doe',
  authorHandle: '@jane',
  content,
});

describe('Phase: Unified Leads', () => {
  describe('Task 1: LLM-confirm detection', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns a ClassifiedSignal when the LLM confirms a signal', async () => {
      vi.mocked(chatCompletion).mockResolvedValue(JSON.stringify({
        is_signal: true, signal_type: 'funding_round',
        company_name: 'Acme', person_name: 'Jane Doe',
        accelerator: null, batch: null, confidence: 0.82,
      }));
      const result = await confirmSignalWithLLM(post('thrilled the a16z team is backing us'));
      expect(result).not.toBeNull();
      expect(result?.signalType).toBe('funding_round');
      expect(result?.companyName).toBe('Acme');
      expect(result?.confidence).toBeCloseTo(0.82);
      expect(result?.dedupeKey).toContain('funding_round');
    });

    it('returns null when the LLM says it is not a signal', async () => {
      vi.mocked(chatCompletion).mockResolvedValue(JSON.stringify({ is_signal: false }));
      expect(await confirmSignalWithLLM(post('had a great coffee today'))).toBeNull();
    });

    it('returns null on unparseable LLM output (fail closed)', async () => {
      vi.mocked(chatCompletion).mockResolvedValue('not json at all');
      expect(await confirmSignalWithLLM(post('ambiguous text here'))).toBeNull();
    });
  });

  describe('Task 2: Hybrid orchestrator', () => {
    beforeEach(() => vi.clearAllMocks());

    it('accepts an obvious keyword hit WITHOUT calling the LLM', async () => {
      // Pure accelerator_join keyword hit (score ~1.0, well above threshold) with
      // no funding/launch keywords mixed in, so bestType is unambiguous.
      const r = await classifyPostHybrid(post('Excited to announce we are joining YC S24 this batch'));
      expect(r?.signalType).toBe('accelerator_join');
      expect(chatCompletion).not.toHaveBeenCalled();
    });

    it('drops obvious junk WITHOUT calling the LLM', async () => {
      const r = await classifyPostHybrid(post('good morning everyone hope you have a nice day'));
      expect(r).toBeNull();
      expect(chatCompletion).not.toHaveBeenCalled();
    });

  });

  describe('Task 2.5: Source-based LLM-confirm trigger', () => {
    beforeEach(() => vi.clearAllMocks());

    it('accepts an obvious keyword hit from a high-value source WITHOUT calling the LLM', async () => {
      const r = await classifyPostHybrid(
        post('Excited to join YC S24!'),
        { highValueSource: true },
      );
      expect(r?.signalType).toBe('accelerator_join');
      expect(chatCompletion).not.toHaveBeenCalled();
    });

    it('escalates a keyword miss from a high-value source to the LLM', async () => {
      vi.mocked(chatCompletion).mockResolvedValue(JSON.stringify({
        is_signal: true, signal_type: 'funding_round', company_name: 'Acme', confidence: 0.8,
      }));
      const r = await classifyPostHybrid(
        post('thrilled the a16z team is backing us'),
        { highValueSource: true },
      );
      expect(chatCompletion).toHaveBeenCalledTimes(1);
      expect(r?.companyName).toBe('Acme');
    });

    it('drops a keyword miss from a non-tracked source WITHOUT calling the LLM', async () => {
      const r = await classifyPostHybrid(
        post('thrilled the a16z team is backing us'),
        { highValueSource: false },
      );
      expect(r).toBeNull();
      expect(chatCompletion).not.toHaveBeenCalled();
    });

    it('drops a keyword miss when no opts are passed at all', async () => {
      const r = await classifyPostHybrid(post('thrilled the a16z team is backing us'));
      expect(r).toBeNull();
      expect(chatCompletion).not.toHaveBeenCalled();
    });

    it('drops a keyword miss from a high-value source when the LLM says it is not a signal', async () => {
      vi.mocked(chatCompletion).mockResolvedValue(JSON.stringify({ is_signal: false }));
      const r = await classifyPostHybrid(
        post('thrilled the a16z team is backing us'),
        { highValueSource: true },
      );
      expect(r).toBeNull();
    });
  });

  describe('Task 2.5b: classifyPostHybridWithMeta cost-cap accounting', () => {
    beforeEach(() => vi.clearAllMocks());

    it('reports escalated:false on a keyword hit, even from a high-value source (no LLM call, cap untouched)', async () => {
      const r = await classifyPostHybridWithMeta(
        post('Excited to join YC S24!'),
        { highValueSource: true },
      );
      expect(r.escalated).toBe(false);
      expect(r.signal?.signalType).toBe('accelerator_join');
      expect(chatCompletion).not.toHaveBeenCalled();
    });

    it('reports escalated:true on a keyword miss from a high-value source (real LLM call, should count against the cap)', async () => {
      vi.mocked(chatCompletion).mockResolvedValue(JSON.stringify({
        is_signal: true, signal_type: 'funding_round', company_name: 'Acme', confidence: 0.8,
      }));
      const r = await classifyPostHybridWithMeta(
        post('thrilled the a16z team is backing us'),
        { highValueSource: true },
      );
      expect(r.escalated).toBe(true);
      expect(chatCompletion).toHaveBeenCalledTimes(1);
      expect(r.signal?.companyName).toBe('Acme');
    });

    it('reports escalated:false on a keyword miss from a non-high-value source (no LLM call)', async () => {
      const r = await classifyPostHybridWithMeta(
        post('thrilled the a16z team is backing us'),
        { highValueSource: false },
      );
      expect(r.escalated).toBe(false);
      expect(r.signal).toBeNull();
      expect(chatCompletion).not.toHaveBeenCalled();
    });

    it('does not let keyword-HIT posts from a high-value source consume the cap: a later genuine keyword-miss still escalates', async () => {
      // Simulate the process-batch loop's cap-gating logic directly: a long run
      // of keyword-hit posts from a tracked source must never decrement the
      // per-batch LLM budget, because classifyPostHybridWithMeta never calls the
      // LLM for a hit regardless of highValueSource. Only escalated:true should
      // increment the counter (this is the exact bug being fixed).
      let llmConfirmsUsed = 0;
      const cap = 10;

      for (let i = 0; i < 50; i++) {
        const capAvailable = llmConfirmsUsed < cap;
        const highValueSource = capAvailable; // sourceIsHighValue is true throughout
        const { escalated } = await classifyPostHybridWithMeta(
          post('Excited to join YC S24!'), // keyword hit every time
          { highValueSource },
        );
        if (escalated) llmConfirmsUsed += 1;
      }

      expect(llmConfirmsUsed).toBe(0);
      expect(chatCompletion).not.toHaveBeenCalled();

      // Now the very first genuine keyword-miss from the same tracked source
      // must still escalate, because the cap was never actually consumed.
      vi.mocked(chatCompletion).mockResolvedValue(JSON.stringify({
        is_signal: true, signal_type: 'funding_round', company_name: 'Acme', confidence: 0.8,
      }));
      const capAvailable = llmConfirmsUsed < cap;
      const r = await classifyPostHybridWithMeta(
        post('thrilled the a16z team is backing us'),
        { highValueSource: capAvailable },
      );

      expect(r.escalated).toBe(true);
      expect(chatCompletion).toHaveBeenCalledTimes(1);
      expect(r.signal?.companyName).toBe('Acme');
    });
  });
});
