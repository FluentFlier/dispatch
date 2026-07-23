/**
 * ICP setup reaches the DB - not just the UI.
 *
 * These drive the real POST /api/leads/icp/chat handler and assert it calls
 * updateDirectorySettings with the parsed ICP. They verify the whole path
 * message → API → parse → persist, and specifically that the deterministic
 * fallback saves when the classifier under-returns (the "just answering, never
 * sets up" bug). Failing here means ICP setup silently no-ops.
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
vi.mock('@/lib/signals/icp/parse-description', () => ({
  parseIcpDescription: vi.fn().mockResolvedValue({
    icp_verticals: ['Fintech'],
    icp_keywords: ['seed', 'YC'],
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
import { putBrainPage } from '@/lib/brain/pages';

const updateMock = updateDirectorySettings as unknown as ReturnType<typeof vi.fn>;
const chatMock = chatCompletion as unknown as ReturnType<typeof vi.fn>;
const brainMock = putBrainPage as unknown as ReturnType<typeof vi.fn>;

function req(message: string): NextRequest {
  return new NextRequest('http://localhost/api/leads/icp/chat', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  brainMock.mockResolvedValue(undefined);
  h.currentIcp = '';
});

describe('POST /api/leads/icp/chat - ICP actually persists', () => {
  it('persists icp_description + derived verticals/keywords when the model returns a brief', async () => {
    chatMock.mockResolvedValue(
      '{"reply":"Set.","icp_description":"Seed fintech founders from YC","run_discovery":false}',
    );
    const res = await POST(req('we sell to seed fintech founders from YC'));
    const body = await res.json();

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][2]).toEqual({
      icp_description: 'Seed fintech founders from YC',
      icp_verticals: ['Fintech'],
      icp_keywords: ['seed', 'YC'],
      discovery_goal: 'find seed fintech',
    });
    expect(body.applied).toBe(true);
    expect(body.hasIcp).toBe(true);
  });

  it('FALLBACK: still persists when the classifier returns an empty icp_description', async () => {
    // The weak-model failure mode: model whiffs, returns no brief. The raw message
    // must still be saved so setup does not silently no-op.
    chatMock.mockResolvedValue('{"reply":"Cool","icp_description":"","run_discovery":false}');
    const msg = 'we sell to seed stage fintech startups in the US that recently raised';
    const res = await POST(req(msg));
    const body = await res.json();

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][2].icp_description).toBe(msg);
    expect(body.applied).toBe(true);
  });

  it('reports the core save as successful when Brain enrichment fails afterward', async () => {
    chatMock.mockResolvedValue(
      '{"reply":"Set.","icp_description":"Seed fintech founders from YC","run_discovery":false}',
    );
    brainMock.mockRejectedValueOnce(new Error('brain unavailable'));

    const res = await POST(req('we sell to seed fintech founders from YC'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(body.applied).toBe(true);
    expect(body.enrichmentWarnings).toContain('brain_sync');
    expect(body.requestId).toEqual(expect.any(String));
  });

  it('does NOT persist a pure "find leads now" command', async () => {
    h.currentIcp = 'existing icp';
    chatMock.mockResolvedValue('{"reply":"","icp_description":"","run_discovery":true}');
    const res = await POST(req('find leads now'));
    const body = await res.json();

    expect(updateMock).not.toHaveBeenCalled();
    expect(body.suggestRun).toBe(true);
  });

  it('does NOT persist a greeting (nothing that looks like an ICP)', async () => {
    chatMock.mockResolvedValue('{"reply":"hi!","icp_description":"","run_discovery":false}');
    const res = await POST(req('hey there'));
    const body = await res.json();

    expect(updateMock).not.toHaveBeenCalled();
    expect(body.applied).toBe(false);
    expect(body.icpUnderstood).toBe(false);
  });
});
