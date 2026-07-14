import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WS4 gate - POST /api/leads/[id]/draft request contract.
 *
 * Exercises the HTTP boundary end to end with a stubbed model: auth + workspace
 * + lead lookup are mocked, and draftOutreachForLead is stubbed (NO live LLM),
 * so we assert the route parses the body correctly (rewriteInstruction trimmed
 * + capped, polish flag), 404s a missing lead, and returns the draft payload.
 */

const getAuthenticatedUser = vi.fn();
const getServerClient = vi.fn();
vi.mock('@/lib/insforge/server', () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  getServerClient: (...a: unknown[]) => getServerClient(...a),
}));
const getActiveWorkspaceId = vi.fn();
vi.mock('@/lib/workspace', () => ({
  getActiveWorkspaceId: (...a: unknown[]) => getActiveWorkspaceId(...a),
}));
const getLead = vi.fn();
vi.mock('@/lib/signals/leads/store', () => ({
  getLead: (...a: unknown[]) => getLead(...a),
}));
const draftOutreachForLead = vi.fn();
vi.mock('@/lib/signals/outreach/draft-lead', () => ({
  draftOutreachForLead: (...a: unknown[]) => draftOutreachForLead(...a),
}));

import { POST } from '@/app/api/leads/[id]/draft/route';

function req(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUser.mockResolvedValue({ id: 'u1' });
  getServerClient.mockReturnValue({});
  getActiveWorkspaceId.mockResolvedValue('ws1');
  getLead.mockResolvedValue({ id: 'l1', company_name: 'Acme' });
  draftOutreachForLead.mockResolvedValue({ draftText: 'A note.', voiceMatchScore: 80 });
});

afterEach(() => vi.restoreAllMocks());

describe('WS4 draft route contract', () => {
  it('passes a trimmed rewrite instruction and returns the draft', async () => {
    const res = await POST(req({ rewriteInstruction: '  shorter, more casual  ' }), { params: { id: 'l1' } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.draftText).toBe('A note.');

    const opts = draftOutreachForLead.mock.calls[0][5] as { rewriteInstruction: string | null; polish: boolean };
    expect(opts.rewriteInstruction).toBe('shorter, more casual');
    expect(opts.polish).toBe(false);
  });

  it('caps a very long rewrite instruction at 280 chars', async () => {
    await POST(req({ rewriteInstruction: 'x'.repeat(400) }), { params: { id: 'l1' } });
    const opts = draftOutreachForLead.mock.calls[0][5] as { rewriteInstruction: string | null };
    expect((opts.rewriteInstruction ?? '').length).toBe(280);
  });

  it('forwards polish=true for the full-quality pass', async () => {
    await POST(req({ polish: true }), { params: { id: 'l1' } });
    const opts = draftOutreachForLead.mock.calls[0][5] as { polish: boolean; rewriteInstruction: string | null };
    expect(opts.polish).toBe(true);
    expect(opts.rewriteInstruction).toBeNull();
  });

  it('404s when the lead does not exist', async () => {
    getLead.mockResolvedValue(null);
    const res = await POST(req({}), { params: { id: 'missing' } });
    expect(res.status).toBe(404);
    expect(draftOutreachForLead).not.toHaveBeenCalled();
  });

  it('401s an unauthenticated request', async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const res = await POST(req({}), { params: { id: 'l1' } });
    expect(res.status).toBe(401);
  });
});
