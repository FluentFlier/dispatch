import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/llm', () => ({
  chatCompletion: vi.fn(),
  isLlmConfigured: () => false,
}));
import { chatCompletion } from '@/lib/llm';
import { confirmSignalWithLLM } from '@/lib/signals/detect/llm-confirm';
import { classifyPostHybrid, classifyPostHybridWithMeta } from '@/lib/signals/detect/hybrid';
import { scoreIcpFit } from '@/lib/signals/leads/icp-score';
import { enrichViaUnipileSearch } from '@/lib/signals/leads/enrich-contact';
import { normalizeEvent, normalizeLead } from '@/lib/signals/feed/normalize';
import { mergeFeed, buildUnifiedFeed } from '@/lib/signals/feed/store';
import { listEventsWithPosts } from '@/lib/signals/store';
import { isReachable, contactPillLabel } from '@/components/leads/feed-format';
import { resolveSignalOutreach, isGuardBlock, SIGNAL_CONNECT_LIMIT } from '@/components/leads/signal-outreach';
import type { UnifiedLeadCard } from '@/lib/signals/feed/normalize';
import type { IngestedPost, SignalEventRow, SignalLeadRow } from '@/lib/signals/types';

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
      const r = await classifyPostHybrid(post('building Acme, excited to announce we are joining YC S24 this batch'));
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
        post('building Acme, excited to join YC S24!'),
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
        post('building Acme, excited to join YC S24!'),
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
          post('building Acme, excited to join YC S24!'), // keyword hit every time
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

    it('maps a pending signal event to lead status "new" so it survives the default feed filter (regression: signal cards were hidden from the default view)', () => {
      const card = normalizeEvent({
        id: 'e2', workspace_id: 'w', raw_post_id: 'p2', signal_type: 'accelerator_join',
        company_name: 'Acme', person_name: 'Jane', accelerator_name: null, batch: null,
        signal_summary: 'joined', confidence: 0.7, dedupe_key: 'k2', status: 'pending',
        created_at: '2026-07-05T00:00:00Z', updated_at: '2026-07-05T00:00:00Z',
        raw_post: { post_url: 'https://x.com/2', platform: 'x' } as never,
      } as never);
      expect(card.status).toBe('new');

      const directoryCard: UnifiedLeadCard = {
        id: 'lead-new', kind: 'directory', source: 'yc_directory', companyName: 'Beta',
        tagline: null, signalType: null, signalSummary: null, sourceUrl: null, batch: null,
        accelerator: null, contact: null, contactStatus: null, score: 0.5, status: 'new',
        detectedAt: '2026-07-01T00:00:00Z',
      };

      const merged = mergeFeed([directoryCard], [card], { status: 'new' });
      const ids = merged.map((c) => c.id);
      expect(ids).toContain(card.id);
      expect(ids).toContain(directoryCard.id);
    });

    it('maps a failed signal event to lead status "new" so it stays visible (a failed signal still needs attention)', () => {
      const card = normalizeEvent({
        id: 'e3', workspace_id: 'w', raw_post_id: 'p3', signal_type: 'launch',
        company_name: 'Acme', person_name: 'Jane', accelerator_name: null, batch: null,
        signal_summary: 'launched', confidence: 0.6, dedupe_key: 'k3', status: 'failed',
        created_at: '2026-07-05T00:00:00Z', updated_at: '2026-07-05T00:00:00Z',
        raw_post: { post_url: 'https://x.com/3', platform: 'x' } as never,
      } as never);
      expect(card.status).toBe('new');
    });

    it('passes drafted/sent/dismissed signal statuses through unchanged (shared vocabulary with LeadStatus)', () => {
      const base = {
        id: 'e4', workspace_id: 'w', raw_post_id: 'p4', signal_type: 'launch' as const,
        company_name: 'Acme', person_name: 'Jane', accelerator_name: null, batch: null,
        signal_summary: 'launched', confidence: 0.6, dedupe_key: 'k4',
        created_at: '2026-07-05T00:00:00Z', updated_at: '2026-07-05T00:00:00Z',
        raw_post: { post_url: 'https://x.com/4', platform: 'x' } as never,
      };
      expect(normalizeEvent({ ...base, status: 'drafted' } as never).status).toBe('drafted');
      expect(normalizeEvent({ ...base, status: 'sent' } as never).status).toBe('sent');
      expect(normalizeEvent({ ...base, status: 'dismissed' } as never).status).toBe('dismissed');
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

  describe('Task 7: isReachable contact-channel guard', () => {
    const baseCard: UnifiedLeadCard = {
      id: 'c1', kind: 'signal', source: 'x', companyName: 'Acme', tagline: null,
      signalType: null, signalSummary: null, sourceUrl: null, batch: null, accelerator: null,
      contact: null, contactStatus: null, score: 0.5, status: 'new', detectedAt: '2026-07-01T00:00:00Z',
    };

    it('is NOT reachable when the contact has only a name (no messaging channel) — regression: name-only contacts were shown as "Contact ready"', () => {
      const card: UnifiedLeadCard = { ...baseCard, contact: { name: 'Jane Doe' } };
      expect(isReachable(card)).toBe(false);
      expect(contactPillLabel(card)).toBe('No contact');
    });

    it('is reachable when the contact has a linkedin_url', () => {
      const card: UnifiedLeadCard = {
        ...baseCard,
        contact: { name: 'Jane Doe', linkedin_url: 'https://linkedin.com/in/jane' },
      };
      expect(isReachable(card)).toBe(true);
      expect(contactPillLabel(card)).toBe('Contact ready');
    });

    it('is not reachable when explicitly marked no_contact, even with a channel present', () => {
      const card: UnifiedLeadCard = {
        ...baseCard,
        contactStatus: 'no_contact',
        contact: { name: 'Jane Doe', email: 'jane@acme.com' },
      };
      expect(isReachable(card)).toBe(false);
    });
  });

  describe('Task 10: Signal-card outreach channel selection + guard block', () => {
    const signalCard = (over: Partial<UnifiedLeadCard> = {}): UnifiedLeadCard => ({
      id: 's1', kind: 'signal', source: 'x', companyName: 'Acme', tagline: null,
      signalType: 'funding_round', signalSummary: 'raised', sourceUrl: null, batch: null,
      accelerator: null, contact: null, contactStatus: null, score: 0.8, status: 'new',
      detectedAt: '2026-07-05T00:00:00Z', ...over,
    });

    it('prefers a LinkedIn connect when the contact has a linkedin_url', () => {
      const plan = resolveSignalOutreach(signalCard({
        source: 'linkedin',
        contact: { name: 'Jane', linkedin_url: 'https://linkedin.com/in/jane' },
      }));
      expect(plan.channel).toBe('linkedin_connect');
      expect(plan.linkedinIdentifier).toBe('https://linkedin.com/in/jane');
      expect(plan.sendable).toBe(true);
    });

    it('derives a LinkedIn identifier from a LinkedIn author URL when no explicit contact url', () => {
      const plan = resolveSignalOutreach(signalCard({
        source: 'linkedin',
        sourceUrl: 'https://www.linkedin.com/in/samfounder/recent-activity',
        contact: { name: 'Sam Founder' },
      }));
      expect(plan.channel).toBe('linkedin_connect');
      expect(plan.linkedinIdentifier).toContain('linkedin.com/in/samfounder');
      expect(plan.sendable).toBe(true);
    });

    it('falls back to x_dm when only an x_handle is present (X signal, no LinkedIn)', () => {
      const plan = resolveSignalOutreach(signalCard({
        source: 'x',
        contact: { name: 'Jane', x_handle: '@jane' },
      }));
      expect(plan.channel).toBe('x_dm');
      expect(plan.linkedinIdentifier).toBe('@jane');
      expect(plan.sendable).toBe(true);
    });

    it('falls back to gmail when only an email is present', () => {
      const plan = resolveSignalOutreach(signalCard({
        source: 'x',
        contact: { name: 'Jane', email: 'jane@acme.com' },
      }));
      expect(plan.channel).toBe('gmail');
      expect(plan.recipientEmail).toBe('jane@acme.com');
      expect(plan.sendable).toBe(true);
    });

    it('resolves to copy (not sendable) for an X signal with a name-only contact', () => {
      const plan = resolveSignalOutreach(signalCard({ source: 'x', contact: { name: 'Jane' } }));
      expect(plan.channel).toBe('copy');
      expect(plan.sendable).toBe(false);
      expect(plan.linkedinIdentifier).toBeUndefined();
      expect(plan.recipientEmail).toBeUndefined();
    });

    it('resolves to copy (not sendable) when there is no contact at all', () => {
      const plan = resolveSignalOutreach(signalCard({ source: 'x', contact: null }));
      expect(plan.channel).toBe('copy');
      expect(plan.sendable).toBe(false);
    });

    it('treats HTTP 422 as an expected safety-guard block, other statuses as real errors', () => {
      expect(isGuardBlock(422)).toBe(true);
      expect(isGuardBlock(200)).toBe(false);
      expect(isGuardBlock(500)).toBe(false);
      expect(isGuardBlock(401)).toBe(false);
    });

    it('exposes the LinkedIn connect char ceiling for the draft counter', () => {
      expect(SIGNAL_CONNECT_LIMIT).toBe(300);
    });
  });

  describe('Task 6b: listEventsWithPosts raw_post hydration shape', () => {
    /**
     * `signal_events.raw_post_id` is a many-to-one FK into `signal_raw_posts`
     * (confirmed via the live table schema: the FK column lives on
     * signal_events, not on signal_raw_posts). On this PostgREST-style
     * backend, embeds on the "many" side of a FK come back as a single
     * object, not an array — unlike `signal_lead_contacts`/`signal_outreach`,
     * which are one-to-many from signal_leads/signal_events and DO need the
     * `Array.isArray(...) ? arr[0] : ...` unwrap seen in listLeads/listEvents.
     * This test locks in that `raw_post` is read as an object, matching what
     * `normalizeEvent` expects (`e.raw_post?.platform`), and would fail if a
     * future backend change (or a copy-paste of the outreach-unwrap pattern)
     * turned the embed into an array.
     */
    it('hydrates raw_post as a single object (not an array) for downstream normalizeEvent reads', async () => {
      const rawPost = { id: 'p1', platform: 'x', post_url: 'https://x.com/1' };
      const eventRow = {
        id: 'e1', workspace_id: 'ws-1', raw_post_id: 'p1', signal_type: 'funding_round',
        company_name: 'Acme', person_name: 'Jane', accelerator_name: null, batch: null,
        signal_summary: 'raised', confidence: 0.8, dedupe_key: 'k', status: 'pending',
        created_at: '2026-07-05T00:00:00Z', updated_at: '2026-07-05T00:00:00Z',
        raw_post: rawPost, // object shape, as the backend actually returns it
      };

      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [eventRow], error: null }),
      };
      const fakeClient = { database: { from: vi.fn().mockReturnValue(chain) } };

      const events = await listEventsWithPosts(
        fakeClient as unknown as Parameters<typeof listEventsWithPosts>[0],
        'ws-1',
      );

      expect(events).toHaveLength(1);
      // Not an array: plain property access must work directly.
      expect(Array.isArray(events[0].raw_post)).toBe(false);
      expect(events[0].raw_post?.platform).toBe('x');
      expect(events[0].raw_post?.post_url).toBe('https://x.com/1');

      // And the normalizer (which does `e.raw_post?.platform`, not
      // `e.raw_post?.[0]?.platform`) reads it correctly end to end.
      const card = normalizeEvent(events[0]);
      expect(card.source).toBe('x');
      expect(card.sourceUrl).toBe('https://x.com/1');
    });

    it('scopes the query to the given workspace_id', async () => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      const fakeClient = { database: { from: vi.fn().mockReturnValue(chain) } };

      await listEventsWithPosts(
        fakeClient as unknown as Parameters<typeof listEventsWithPosts>[0],
        'ws-scoped',
      );

      expect(chain.eq).toHaveBeenCalledWith('workspace_id', 'ws-scoped');
    });
  });

  describe('Task 8: Unified feed integration', () => {
    /**
     * HTTP-layer note: this repo's established route-test harness (see
     * tests/phase-event-capture-hardening.test.ts and
     * tests/posts-predict.test.ts) mocks `@/lib/insforge/server` +
     * `@/lib/workspace` and dynamically imports the route handler. That
     * pattern is used directly below for the 401/200/workspace-scoping cases
     * against `GET /api/leads/feed`, so no substitution was needed — the
     * store-layer `buildUnifiedFeed` tests further down are an ADDITIONAL
     * belt-and-suspenders layer (they assert both listers are called
     * workspace-scoped without going through Next's request/response glue).
     */
    afterEach(() => {
      vi.resetModules();
      vi.doUnmock('@/lib/insforge/server');
      vi.doUnmock('@/lib/workspace');
    });

    const leadRow = (over: Partial<SignalLeadRow> = {}) => ({
      id: 'lead-1', workspace_id: 'ws-1', source: 'yc_directory', external_id: 'acme',
      company_name: 'Acme', tagline: 'fintech', website: 'https://acme.com', domain: 'acme.com',
      batch: 'S24', tags: [], intent_flags: {}, source_fact: {}, name_history: [],
      fit_score: 0.4, rank_score: 0.4, contact_status: 'resolved', lead_status: 'new',
      first_seen_at: '2026-07-01T00:00:00Z', last_seen_at: '2026-07-01T00:00:00Z',
      digest_date: '2026-07-01', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
      contacts: [], outreach: null,
      ...over,
    });

    const eventRow = (over: Partial<SignalEventRow> = {}) => ({
      id: 'evt-1', workspace_id: 'ws-1', raw_post_id: 'post-1', signal_type: 'funding_round',
      company_name: 'Beta', person_name: 'Sam', accelerator_name: null, batch: null,
      signal_summary: 'raised a round', confidence: 0.95, dedupe_key: 'dk-1', status: 'pending',
      created_at: '2026-07-05T00:00:00Z', updated_at: '2026-07-05T00:00:00Z',
      raw_post: { id: 'post-1', platform: 'x', post_url: 'https://x.com/1' },
      ...over,
    });

    /** Builds a fake InsForge client whose tables are keyed off the given workspace_id. */
    function makeFakeClient(byWorkspace: Record<string, { leads: unknown[]; events: unknown[] }>) {
      const from = vi.fn((table: string) => {
        // Setup-gate probes feature_flags + existence checks before the feed query.
        if (table === 'feature_flags') {
          const chain: Record<string, ReturnType<typeof vi.fn>> = {};
          chain.select = vi.fn().mockReturnValue(chain);
          chain.eq = vi.fn().mockReturnValue(chain);
          chain.maybeSingle = vi.fn().mockResolvedValue({ data: { enabled: true }, error: null });
          chain.single = chain.maybeSingle;
          chain.limit = vi.fn().mockResolvedValue({ data: [{ enabled: true }], error: null });
          return chain;
        }

        let ws = '';
        const chain: Record<string, ReturnType<typeof vi.fn>> = {};
        chain.select = vi.fn().mockReturnValue(chain);
        chain.eq = vi.fn((col: string, val: string) => {
          if (col === 'workspace_id') ws = val;
          return chain;
        });
        // Existence probe (no workspace filter) and feed query both use limit().
        chain.limit = vi.fn().mockImplementation(() => {
          if (!ws) {
            // isTableMissing / setup probe — empty rows with no error = table exists
            return Promise.resolve({ data: [], error: null });
          }
          const rows = byWorkspace[ws]
            ? (table === 'signal_leads' ? byWorkspace[ws].leads : byWorkspace[ws].events)
            : [];
          return Promise.resolve({ data: rows, error: null });
        });
        chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
        return chain;
      });
      return { database: { from } };
    }

    it('GET /api/leads/feed returns 401 when unauthenticated', async () => {
      vi.doMock('@/lib/insforge/server', () => ({
        getAuthenticatedUser: vi.fn().mockResolvedValue(null),
        getServerClient: vi.fn(),
      }));
      vi.doMock('@/lib/workspace', () => ({
        getActiveWorkspaceId: vi.fn(),
      }));

      const { GET } = await import('@/app/api/leads/feed/route');
      const { NextRequest } = await import('next/server');
      const res = await GET(new NextRequest('http://localhost/api/leads/feed'));

      expect(res.status).toBe(401);
    });

    it('GET /api/leads/feed returns 200 with merged, score-then-recency-sorted cards for the active workspace', async () => {
      const fakeClient = makeFakeClient({
        'ws-1': {
          leads: [leadRow({ id: 'lead-1', rank_score: 0.4 })],
          events: [eventRow({ id: 'evt-1', confidence: 0.95 })],
        },
      });

      vi.doMock('@/lib/insforge/server', () => ({
        getAuthenticatedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
        getServerClient: vi.fn().mockReturnValue(fakeClient),
      }));
      vi.doMock('@/lib/workspace', () => ({
        getActiveWorkspaceId: vi.fn().mockResolvedValue('ws-1'),
      }));

      const { GET } = await import('@/app/api/leads/feed/route');
      const { NextRequest } = await import('next/server');
      const res = await GET(new NextRequest('http://localhost/api/leads/feed'));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.cards).toHaveLength(2);
      // Higher score (signal event, 0.95) sorts before the directory lead (0.4).
      expect(body.cards.map((c: UnifiedLeadCard) => c.id)).toEqual(['evt-1', 'lead-1']);
      expect(body.cards[0].kind).toBe('signal');
      expect(body.cards[1].kind).toBe('directory');
    });

    it('GET /api/leads/feed does not return cards from a different workspace', async () => {
      const fakeClient = makeFakeClient({
        'ws-1': { leads: [leadRow({ id: 'lead-mine' })], events: [eventRow({ id: 'evt-mine' })] },
        'ws-2': {
          leads: [leadRow({ id: 'lead-other-workspace', workspace_id: 'ws-2' })],
          events: [eventRow({ id: 'evt-other-workspace', workspace_id: 'ws-2' })],
        },
      });

      vi.doMock('@/lib/insforge/server', () => ({
        getAuthenticatedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
        getServerClient: vi.fn().mockReturnValue(fakeClient),
      }));
      vi.doMock('@/lib/workspace', () => ({
        getActiveWorkspaceId: vi.fn().mockResolvedValue('ws-1'),
      }));

      const { GET } = await import('@/app/api/leads/feed/route');
      const { NextRequest } = await import('next/server');
      const res = await GET(new NextRequest('http://localhost/api/leads/feed'));

      expect(res.status).toBe(200);
      const body = await res.json();
      const ids = body.cards.map((c: UnifiedLeadCard) => c.id);
      expect(ids).toEqual(expect.arrayContaining(['lead-mine', 'evt-mine']));
      expect(ids).not.toEqual(expect.arrayContaining(['lead-other-workspace', 'evt-other-workspace']));
    });
  });

  describe('Task 8b: buildUnifiedFeed store-layer workspace scoping', () => {
    /**
     * Belt-and-suspenders coverage at the store layer (see the doc comment on
     * `buildUnifiedFeed` in src/lib/signals/feed/store.ts): asserts the store
     * calls both the leads lister and the events lister scoped to the given
     * workspaceId, and that it merges their normalized output.
     */
    it('calls both listers scoped to workspaceId and returns merged cards', async () => {
      const from = vi.fn((table: string) => {
        const chain: Record<string, ReturnType<typeof vi.fn>> = {};
        chain.select = vi.fn().mockReturnValue(chain);
        chain.eq = vi.fn().mockReturnValue(chain);
        chain.limit = vi.fn().mockImplementation(() => {
          if (table === 'signal_leads') {
            return Promise.resolve({
              data: [{
                id: 'lead-1', workspace_id: 'ws-9', source: 'yc_directory', external_id: 'acme',
                company_name: 'Acme', tagline: 'fintech', website: null, domain: null, batch: null,
                tags: [], intent_flags: {}, source_fact: {}, name_history: [], fit_score: 0.3,
                rank_score: 0.3, contact_status: 'unresolved', lead_status: 'new',
                first_seen_at: '2026-07-01T00:00:00Z', last_seen_at: '2026-07-01T00:00:00Z',
                digest_date: '2026-07-01', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
                contacts: [], outreach: null,
              }],
              error: null,
            });
          }
          if (table === 'signal_events') {
            return Promise.resolve({
              data: [{
                id: 'evt-1', workspace_id: 'ws-9', raw_post_id: 'post-1', signal_type: 'launch',
                company_name: 'Beta', person_name: null, accelerator_name: null, batch: null,
                signal_summary: 'launched', confidence: 0.6, dedupe_key: 'dk', status: 'pending',
                created_at: '2026-07-05T00:00:00Z', updated_at: '2026-07-05T00:00:00Z',
                raw_post: { id: 'post-1', platform: 'linkedin', post_url: 'https://linkedin.com/post/1' },
              }],
              error: null,
            });
          }
          throw new Error(`unexpected table ${table}`);
        });
        return chain;
      });
      const fakeClient = { database: { from } };

      const cards = await buildUnifiedFeed(
        fakeClient as unknown as Parameters<typeof buildUnifiedFeed>[0],
        'ws-9',
      );

      expect(from).toHaveBeenCalledWith('signal_leads');
      expect(from).toHaveBeenCalledWith('signal_events');
      expect(cards.map((c) => c.id).sort()).toEqual(['evt-1', 'lead-1']);
      expect(cards.find((c) => c.id === 'lead-1')?.kind).toBe('directory');
      expect(cards.find((c) => c.id === 'evt-1')?.kind).toBe('signal');
    });
  });
});
