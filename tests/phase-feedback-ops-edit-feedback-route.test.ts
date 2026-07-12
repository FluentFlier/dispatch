/**
 * Phase: Feedback Ops - POST /api/hooks/feedback edit-penalty wiring (Task 2).
 * A heavy edit (magnitude >= 30, matching rl-trainer's "heavy rewrite" bar)
 * applies a half-weight negative (beta += 0.5) to the used hooks' Thompson
 * arms via applyEditPenaltyToArms. Lighter edits leave arms untouched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { applyEditPenaltyToArms } = vi.hoisted(() => ({
  applyEditPenaltyToArms: vi.fn().mockResolvedValue(1),
}));

vi.mock('@/lib/insforge/server', () => ({
  getAuthenticatedUser: vi.fn().mockResolvedValue({ id: 'u1' }),
  getServerClient: () => ({
    database: {
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
      }),
    },
  }),
}));
vi.mock('@/lib/hooks-intelligence/rl-trainer', () => ({
  updateFromEditsDB: vi.fn().mockResolvedValue(1),
  updateFromEdits: vi.fn(),
}));
vi.mock('@/lib/engagement/categorize-leads', () => ({ pillarToVertical: (p: string) => p }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/lib/hooks-intelligence/rewards', () => ({ applyEditPenaltyToArms }));

function makeRequest(totalChanges: number, hookIds: string[] = ['h1']) {
  return new NextRequest('http://localhost/api/hooks/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postId: 'p1',
      pillar: 'saas',
      used_hook_ids: hookIds,
      originalContent: { hook: 'a'.repeat(10) },
      editedContent: { hook: 'a'.repeat(10 + totalChanges) },
      diffs: { totalChanges },
    }),
  });
}

describe('POST /api/hooks/feedback - edit penalty wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyEditPenaltyToArms.mockResolvedValue(1);
  });

  it('heavy edit (magnitude >= 30) applies the edit penalty to arms', async () => {
    const { POST } = await import('@/app/api/hooks/feedback/route');
    // totalChanges=150 -> magnitude = round(150/5) = 30 (the exact "heavy" bar)
    const res = await POST(makeRequest(150));
    const json = await res.json();

    expect(applyEditPenaltyToArms).toHaveBeenCalledWith(expect.anything(), ['h1']);
    expect(json.armsPenalized).toBe(1);
  });

  it('light edit below the heavy-rewrite bar does not touch arms', async () => {
    const { POST } = await import('@/app/api/hooks/feedback/route');
    // totalChanges=20 -> magnitude = max(10, round(20/5)) = 10, well under 30
    const res = await POST(makeRequest(20));
    const json = await res.json();

    expect(applyEditPenaltyToArms).not.toHaveBeenCalled();
    expect(json.armsPenalized).toBe(0);
  });

  it('no used hooks means no arm penalty even for a heavy edit', async () => {
    const { POST } = await import('@/app/api/hooks/feedback/route');
    const res = await POST(makeRequest(150, []));
    const json = await res.json();

    expect(applyEditPenaltyToArms).not.toHaveBeenCalled();
    expect(json.armsPenalized).toBe(0);
  });
});
