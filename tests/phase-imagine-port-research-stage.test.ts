/**
 * Phase: Imagine port - Stage 0 research.
 * The research stage is strictly best-effort: it enriches context with a
 * RESEARCH NOTES section when configured and working, and silently returns
 * null on any failure so generation never depends on it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  runResearchStage,
  isResearchConfigured,
  formatResearchBlock,
  RESEARCH_HEADER,
} from '@/lib/content-pipeline/research';
import { substanceContextOnly, voiceEvidenceOnly } from '@/lib/content-pipeline/context-split';

vi.mock('@/lib/llm', () => ({
  chatCompletion: vi.fn(),
}));
vi.mock('@/lib/content-pipeline/events', () => ({
  emitPipelineEvent: vi.fn().mockResolvedValue(undefined),
}));

import { chatCompletion } from '@/lib/llm';
import { emitPipelineEvent } from '@/lib/content-pipeline/events';

const mockedChat = vi.mocked(chatCompletion);
const mockedEmit = vi.mocked(emitPipelineEvent);

const APIFY_ITEMS = [
  {
    organicResults: [
      { title: 'Developer survey 2026', url: 'https://www.example.com/survey', description: '62% of developers now ship with AI assistance daily.' },
      { title: 'Developer survey 2026', url: 'https://dup.example.com', description: 'duplicate title should be deduped' },
      { title: 'Shipping velocity report', url: 'https://stats.dev/report', description: 'Median time-to-merge dropped from 4 days to 26 hours.' },
    ],
  },
];

function stubFetch(response: unknown, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => response,
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('APIFY_TOKEN', 'test-token');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('isResearchConfigured', () => {
  it('requires APIFY_TOKEN', () => {
    expect(isResearchConfigured()).toBe(true);
    vi.stubEnv('APIFY_TOKEN', '');
    expect(isResearchConfigured()).toBe(false);
  });
});

describe('runResearchStage', () => {
  it('returns null without calling anything when unconfigured', async () => {
    vi.stubEnv('APIFY_TOKEN', '');
    const fetchFn = stubFetch(APIFY_ITEMS);
    const block = await runResearchStage({ userPrompt: 'p', requestId: 'r1' });
    expect(block).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it('returns a RESEARCH NOTES block with deduped findings on success', async () => {
    mockedChat.mockResolvedValue('{"queries": ["developer ai adoption stats"]}');
    stubFetch(APIFY_ITEMS);
    const block = await runResearchStage({ userPrompt: 'post about AI dev tools', requestId: 'r1' });
    expect(block).toContain(RESEARCH_HEADER);
    expect(block).toContain('62% of developers');
    expect(block).toContain('example.com');
    expect(block).not.toContain('duplicate title');
    expect(mockedEmit).toHaveBeenCalledWith(expect.objectContaining({ event: 'research_complete' }));
  });

  it('falls back to the raw brief as the query when synthesis returns junk', async () => {
    mockedChat.mockResolvedValue('sorry, I cannot help with that');
    const fetchFn = stubFetch(APIFY_ITEMS);
    const block = await runResearchStage({ userPrompt: 'why cold outreach is dead', requestId: 'r1' });
    expect(block).toContain(RESEARCH_HEADER);
    const body = JSON.parse(fetchFn.mock.calls[0][1].body as string) as { queries: string };
    expect(body.queries).toContain('why cold outreach is dead');
  });

  it('returns null and emits research_failed on HTTP errors', async () => {
    mockedChat.mockResolvedValue('{"queries": ["q"]}');
    stubFetch({ error: 'nope' }, 402);
    const block = await runResearchStage({ userPrompt: 'p', requestId: 'r1' });
    expect(block).toBeNull();
    expect(mockedEmit).toHaveBeenCalledWith(expect.objectContaining({ event: 'research_failed' }));
  });

  it('returns null and emits research_failed when no organic results', async () => {
    mockedChat.mockResolvedValue('{"queries": ["q"]}');
    stubFetch([{ organicResults: [] }]);
    const block = await runResearchStage({ userPrompt: 'p', requestId: 'r1' });
    expect(block).toBeNull();
    expect(mockedEmit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'research_failed', detail: expect.objectContaining({ reason: 'no_results' }) }),
    );
  });
});

describe('RESEARCH NOTES context-split integration', () => {
  const block = formatResearchBlock([
    { title: 'T', url: 'https://a.com/x', snippet: 'S' },
  ]);
  const additions = ['USER CONTEXT: niche founder', 'VOICE EXAMPLES\npost one', block].join('\n\n');

  it('reaches the substance stages', () => {
    expect(substanceContextOnly(additions)).toContain(RESEARCH_HEADER);
  });

  it('is not treated as voice evidence', () => {
    expect(voiceEvidenceOnly(additions)).not.toContain(RESEARCH_HEADER);
  });
});
