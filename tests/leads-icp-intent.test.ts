/**
 * F2 ICP CHAT INTENT (leads rebuild audit).
 *
 * Natural discovery phrasing must be detected WITHOUT the literal word
 * "leads": "find me seed-stage fintech founders in NYC" is a search command,
 * not an ICP brief. Today the deterministic fallback regex requires the word
 * "leads", so when the classifier whiffs these turns get mis-saved as ICP
 * briefs - the red tests here encode the expected routing.
 *
 * Also encodes the save-only rule: an ICP-brief turn saves but never
 * auto-runs discovery in the same turn.
 *
 * Mock setup mirrors tests/icp-chat-persist.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({ currentIcp: '' }));

vi.mock('@/lib/insforge/server', () => ({
  getAuthenticatedUser: vi.fn().mockResolvedValue({ id: 'u1' }),
  getServerClient: vi.fn(() => ({})),
}));
vi.mock('@/lib/workspace', () => ({ getActiveWorkspaceId: vi.fn().mockResolvedValue('ws1') }));
vi.mock('@/lib/signals/ingest/workspace-account', () => ({
  getWorkspaceOwnerUserId: vi.fn().mockResolvedValue('u1'),
}));
vi.mock('@/lib/brain/pages', () => ({ putBrainPage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/brain/types', () => ({ BRAIN_SLUG: { gtm: 'gtm' } }));
vi.mock('@/lib/signals/leads/topic-sync', () => ({
  syncIcpKeywordsToTopics: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/signals/icp/parse-description', () => ({
  parseIcpDescription: vi.fn().mockResolvedValue({
    icp_verticals: ['Fintech'],
    icp_keywords: ['seed'],
    gtm: { icp: 'x', pitch: '', objections: '', proof_points: '', cta_style: '' },
    discovery_goal: 'find seed fintech',
  }),
}));
vi.mock('@/lib/signals/leads/store', () => ({
  getDirectorySettings: vi.fn(async () => ({
    icp_description: h.currentIcp || null,
    icp_verticals: [],
    icp_keywords: [],
    enabled_sources: [],
  })),
  updateDirectorySettings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/llm', () => ({
  chatCompletion: vi.fn(),
  LlmError: class LlmError extends Error {
    isQuota = false;
  },
}));

import { POST } from '@/app/api/leads/icp/chat/route';
import { updateDirectorySettings } from '@/lib/signals/leads/store';
import { chatCompletion } from '@/lib/llm';

const updateMock = updateDirectorySettings as unknown as ReturnType<typeof vi.fn>;
const chatMock = chatCompletion as unknown as ReturnType<typeof vi.fn>;

function req(message: string): NextRequest {
  return new NextRequest('http://localhost/api/leads/icp/chat', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

/** The weak-classifier failure mode: model returns nothing useful. */
const CLASSIFIER_WHIFF = '{"reply":"","icp_description":"","run_discovery":false}';

beforeEach(() => {
  vi.clearAllMocks();
  h.currentIcp = '';
});

describe('F2: discovery intent is detected without the literal word "leads"', () => {
  const discoveryPhrasings = [
    'find me seed-stage fintech founders in NYC',
    'search for healthtech companies',
    'pull startups in Berlin',
  ];

  for (const msg of discoveryPhrasings) {
    it(`treats "${msg}" as a discovery command, not an ICP brief`, async () => {
      h.currentIcp = 'seed-stage B2B founders'; // an ICP already exists
      chatMock.mockResolvedValue(CLASSIFIER_WHIFF);

      const res = await POST(req(msg));
      const body = await res.json();

      // A search command must trigger discovery, and must NOT overwrite the
      // saved ICP with the search phrasing.
      expect(body.suggestRun).toBe(true);
      expect(updateMock).not.toHaveBeenCalled();
    });
  }
});

describe('F2: an ICP brief is saved, never mistaken for discovery', () => {
  it('saves "we sell to CFOs of mid-market SaaS" as a brief (no discovery run)', async () => {
    chatMock.mockResolvedValue(CLASSIFIER_WHIFF);

    const res = await POST(req('we sell to CFOs of mid-market SaaS'));
    const body = await res.json();

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][2].icp_description).toContain('CFOs of mid-market SaaS');
    expect(body.suggestRun).toBe(false);
  });

  it('save-only rule: a turn that sets the ICP never auto-runs discovery, even if the classifier says run', async () => {
    chatMock.mockResolvedValue(
      '{"reply":"Saved.","icp_description":"CFOs of mid-market SaaS","run_discovery":true}',
    );

    const res = await POST(req('we sell to CFOs of mid-market SaaS'));
    const body = await res.json();

    expect(body.applied).toBe(true);
    expect(body.suggestRun).toBe(false);
  });
});
