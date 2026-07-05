import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/llm', () => ({
  chatCompletion: vi.fn(),
}));
import { chatCompletion } from '@/lib/llm';
import { confirmSignalWithLLM } from '@/lib/signals/detect/llm-confirm';
import { classifyPostHybrid, classifyPostHybridWithMeta } from '@/lib/signals/detect/hybrid';
import { scoreIcpFit } from '@/lib/signals/leads/icp-score';
import { enrichViaUnipileSearch } from '@/lib/signals/leads/enrich-contact';
import { normalizeEvent, normalizeLead } from '@/lib/signals/feed/normalize';
import { mergeFeed } from '@/lib/signals/feed/store';
import type { UnifiedLeadCard } from '@/lib/signals/feed/normalize';
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

  describe('Task 3: ICP-fit scoring', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns the LLM fit score for an on-ICP company', async () => {
      vi.mocked(chatCompletion).mockResolvedValue('0.9');
      const s = await scoreIcpFit({
        companyName: 'PayFlow', tagline: 'fintech payments for startups',
        tags: ['fintech'], verticals: ['fintech'], keywords: ['payments'],
      });
      expect(s).toBeCloseTo(0.9);
    });

    it('returns neutral 0.5 when no ICP is configured (no LLM call)', async () => {
      const s = await scoreIcpFit({ companyName: 'X', verticals: [], keywords: [] });
      expect(s).toBe(0.5);
      expect(chatCompletion).not.toHaveBeenCalled();
    });

    it('clamps garbage LLM output to a neutral score', async () => {
      vi.mocked(chatCompletion).mockResolvedValue('banana');
      const s = await scoreIcpFit({ companyName: 'X', verticals: ['fintech'], keywords: [] });
      expect(s).toBe(0.5);
    });
  });

  describe('Task 4: Unipile name-search contact step', () => {
    it('returns a contact when Unipile finds the founder', async () => {
      const fakeSearch = vi.fn().mockResolvedValue({
        name: 'Sam Founder', role: 'CEO',
        linkedinUrl: 'https://www.linkedin.com/in/samfounder',
      });
      const found = await enrichViaUnipileSearch(
        { companyName: 'Acme', founderName: 'Sam Founder' },
        { search: fakeSearch },
      );
      expect(found?.linkedinUrl).toContain('linkedin.com/in/');
      expect(found?.via).toBe('unipile');
    });

    it('returns null when Unipile finds nothing', async () => {
      const found = await enrichViaUnipileSearch(
        { companyName: 'Acme', founderName: 'Nobody' },
        { search: vi.fn().mockResolvedValue(null) },
      );
      expect(found).toBeNull();
    });
  });

  describe('Task 5: Feed normalizer', () => {
    it('maps a signal event to a unified card', () => {
      const card = normalizeEvent({
        id: 'e1', workspace_id: 'w', raw_post_id: 'p1', signal_type: 'funding_round',
        company_name: 'Acme', person_name: 'Jane', accelerator_name: null, batch: null,
        signal_summary: 'raised', confidence: 0.8, dedupe_key: 'k', status: 'pending',
        created_at: '2026-07-05T00:00:00Z', updated_at: '2026-07-05T00:00:00Z',
        raw_post: { post_url: 'https://x.com/1', platform: 'x' } as never,
      } as never);
      expect(card.kind).toBe('signal');
      expect(card.source).toBe('x');
      expect(card.companyName).toBe('Acme');
      expect(card.sourceUrl).toBe('https://x.com/1');
      expect(card.score).toBeCloseTo(0.8);
    });

    it('maps a directory lead to a unified card with contact', () => {
      const card = normalizeLead({
        id: 'l1', workspace_id: 'w', source: 'yc_directory', external_id: 'acme',
        company_name: 'Acme', tagline: 'fintech', website: 'https://acme.com', domain: 'acme.com',
        batch: 'S24', tags: [], intent_flags: {}, source_fact: {}, name_history: [],
        fit_score: 0.9, rank_score: 0.9, contact_status: 'resolved', lead_status: 'new',
        first_seen_at: 'x', last_seen_at: 'x', digest_date: '2026-07-05',
        contacts: [{ name: 'Sam', role: 'CEO', linkedin_url: 'https://linkedin.com/in/sam', is_primary: true }],
        primary_contact: { name: 'Sam', role: 'CEO', linkedin_url: 'https://linkedin.com/in/sam' },
      } as never);
      expect(card.kind).toBe('directory');
      expect(card.source).toBe('yc_directory');
      expect(card.contact?.name).toBe('Sam');
      expect(card.batch).toBe('S24');
      expect(card.score).toBeCloseTo(0.9);
    });
  });

  describe('Task 6: Feed merge/sort/filter', () => {
    const card = (over: Partial<UnifiedLeadCard>): UnifiedLeadCard => ({
      id: 'x', kind: 'directory', source: 'yc_directory', companyName: 'C', tagline: null,
      signalType: null, signalSummary: null, sourceUrl: null, batch: null, accelerator: null,
      contact: null, contactStatus: null, score: 0.5, status: 'new', detectedAt: '2026-07-01T00:00:00Z',
      ...over,
    });

    it('sorts by score desc then detectedAt desc', () => {
      const out = mergeFeed(
        [card({ id: 'a', score: 0.4 })],
        [card({ id: 'b', kind: 'signal', source: 'x', score: 0.9 })],
        {},
      );
      expect(out.map((c) => c.id)).toEqual(['b', 'a']);
    });

    it('filters by status', () => {
      const out = mergeFeed(
        [card({ id: 'a', status: 'new' }), card({ id: 'b', status: 'sent' })],
        [], { status: 'sent' },
      );
      expect(out.map((c) => c.id)).toEqual(['b']);
    });

    it('filters by kind', () => {
      const out = mergeFeed(
        [card({ id: 'a' })],
        [card({ id: 'b', kind: 'signal', source: 'x' })],
        { kind: 'signal' },
      );
      expect(out.map((c) => c.id)).toEqual(['b']);
    });
  });
});
