/**
 * Phase 2 - Fake feature cleanup regression tests.
 * Verifies stubs are honest and don't return misleading success signals.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// P2-1: supervisor-agent - returns honest status, doesn't claim RL ran
// ---------------------------------------------------------------------------
describe('P2-1: supervisor agent - honest stub', () => {
  beforeEach(() => vi.resetModules());

  it('returns hook-context-only status (not cycle-complete)', async () => {
    vi.doMock('@/lib/hooks-intelligence/retriever', () => ({
      getHookContextForAgent: vi.fn().mockReturnValue('Hook example 1. Hook example 2.'),
    }));

    const { runContentIntelligenceSupervisor } = await import(
      '@/lib/hooks-intelligence/supervisor-agent'
    );

    const result = await runContentIntelligenceSupervisor('user-123', 'launch product');

    expect(result.status).toBe('hook-context-only');
    expect(result.usageTracked).toBe(false);
    // Must not claim the cycle is complete when RL didn't run
    expect(result.status).not.toBe('cycle-complete');
  });

  it('does not call runTrainingStep', async () => {
    const rlTrainerMock = { runTrainingStep: vi.fn() };
    vi.doMock('@/lib/hooks-intelligence/rl-trainer', () => rlTrainerMock);
    vi.doMock('@/lib/hooks-intelligence/retriever', () => ({
      getHookContextForAgent: vi.fn().mockReturnValue('some hooks'),
    }));

    await import('@/lib/hooks-intelligence/supervisor-agent').then((m) =>
      m.runContentIntelligenceSupervisor('user-123', 'brief')
    );

    expect(rlTrainerMock.runTrainingStep).not.toHaveBeenCalled();
  });

  it('does not charge usage (usageTracked: false)', async () => {
    vi.doMock('@/lib/hooks-intelligence/retriever', () => ({
      getHookContextForAgent: vi.fn().mockReturnValue('hooks'),
    }));

    const { runContentIntelligenceSupervisor } = await import(
      '@/lib/hooks-intelligence/supervisor-agent'
    );
    const result = await runContentIntelligenceSupervisor('user-123', 'brief');
    expect(result.usageTracked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P2-2: video auto-edit - non-caption requests return 501, not fake processing
// ---------------------------------------------------------------------------
describe('P2-2: video auto-edit route - non-caption returns 501', () => {
  beforeEach(() => vi.resetModules());

  it('returns 501 for silence removal request (non-caption option)', async () => {
    vi.doMock('@/lib/insforge/server', () => ({
      getAuthenticatedUser: vi.fn().mockResolvedValue({ id: 'user-123', email: 'test@test.com' }),
      getServerClient: vi.fn().mockReturnValue({}),
    }));
    vi.doMock('@/lib/ai-guard', () => ({
      guardAiRequest: vi.fn().mockResolvedValue({ ok: true }),
    }));

    const { POST } = await import('@/app/api/video/auto-edit/route');
    const { NextRequest } = await import('next/server');

    const req = new NextRequest('http://localhost/api/video/auto-edit', {
      method: 'POST',
      body: JSON.stringify({
        videoUrl: 'https://example.com/video.mp4',
        options: { silenceRemoval: true, captions: false },
      }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(501);

    const body = await res.json();
    expect(body.status).toBe('not_available');
  });

  it('still returns 200 for caption-only requests (this feature works)', async () => {
    vi.resetModules();
    vi.doMock('@/lib/insforge/server', () => ({
      getAuthenticatedUser: vi.fn().mockResolvedValue({ id: 'user-123', email: 'test@test.com' }),
      getServerClient: vi.fn().mockReturnValue({
        ai: {
          chat: {
            completions: {
              create: vi.fn().mockResolvedValue({
                choices: [{ message: { content: '[{"text":"Hello","startFrame":0,"endFrame":30}]' } }],
              }),
            },
          },
        },
      }),
    }));
    vi.doMock('@/lib/ai-guard', () => ({
      guardAiRequest: vi.fn().mockResolvedValue({ ok: true }),
    }));

    const { POST } = await import('@/app/api/video/auto-edit/route');
    const { NextRequest } = await import('next/server');

    const req = new NextRequest('http://localhost/api/video/auto-edit', {
      method: 'POST',
      body: JSON.stringify({
        videoUrl: 'https://example.com/video.mp4',
        options: { captions: true },
      }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// P2-3: usage-tracker JSDoc - no longer claims to enforce limits
// ---------------------------------------------------------------------------
describe('P2-3: usage-tracker - always returns allowed:true (logging only)', () => {
  it('returns allowed:true even when increment fails', async () => {
    vi.resetModules();
    vi.doMock('@/lib/usage', () => ({
      incrementUsage: vi.fn().mockRejectedValue(new Error('DB down')),
    }));
    vi.doMock('@/lib/insforge/server', () => ({
      getServerClient: vi.fn().mockReturnValue({
        database: { from: vi.fn().mockReturnValue({ insert: vi.fn().mockResolvedValue({}) }) },
      }),
    }));

    const { usage } = await import('@/lib/hooks-intelligence/usage-tracker');
    const result = await usage.track('user-123', 'generate');
    expect(result.allowed).toBe(true);
  });
});
