import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/llm', () => ({
  chatCompletion: vi.fn(),
}));
import { chatCompletion } from '@/lib/llm';
import { confirmSignalWithLLM } from '@/lib/signals/detect/llm-confirm';
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
});
