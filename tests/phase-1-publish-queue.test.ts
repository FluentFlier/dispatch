/**
 * Phase 1 — Publish Queue reliability regression tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared mock factory for the InsForge DB client
function makeDbMock(overrides: Record<string, unknown> = {}) {
  const updateMock = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    lt: vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [{ id: 'job-1' }], error: null }),
    }),
  });
  return {
    database: {
      from: vi.fn().mockReturnValue({
        update: updateMock,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// P1-1: Direct-mode publish jobs update DB to 'failed' before returning
// ---------------------------------------------------------------------------
describe('P1-1: processPublishJob — direct mode updates DB before returning', () => {
  beforeEach(() => vi.resetModules());

  it('writes status=failed to DB when provider is not unipile', async () => {
    const dbMock = makeDbMock();
    const updateChain = {
      eq: vi.fn().mockResolvedValue({ error: null }),
    };
    const updateFn = vi.fn().mockReturnValue(updateChain);
    dbMock.database.from = vi.fn().mockReturnValue({ update: updateFn, select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() });

    vi.doMock('@/lib/insforge/server', () => ({
      getServerClient: vi.fn().mockReturnValue(dbMock),
    }));
    vi.doMock('@/lib/social', () => ({
      getSocialProvider: vi.fn().mockReturnValue({ name: 'direct', publish: vi.fn() }),
    }));
    vi.doMock('@/lib/usage', () => ({ incrementUsage: vi.fn() }));
    vi.doMock('@/lib/logger', () => ({ logInfo: vi.fn(), logError: vi.fn() }));
    vi.doMock('@/lib/brain/sync', () => ({ syncBrainPublishedPost: vi.fn() }));

    const { processPublishJob } = await import('@/lib/publish-queue');

    const job = {
      id: 'job-123', user_id: 'u1', post_id: 'p1', platform: 'twitter',
      status: 'queued' as const, idempotency_key: 'ik', scheduled_for: null,
      attempts: 0, max_attempts: 3, last_error: null,
      provider: 'direct', provider_post_id: null, provider_url: null,
    };

    const result = await processPublishJob(job, { caption: 'test content' });

    // Result must reflect failed status
    expect(result.status).toBe('failed');
    expect(result.last_error).toContain('Direct publish');

    // DB must have been called to update the row
    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });
});

// ---------------------------------------------------------------------------
// P1-2: resetStuckProcessingJobs — resets old processing jobs to failed
// ---------------------------------------------------------------------------
describe('P1-2: resetStuckProcessingJobs — watchdog resets stuck jobs', () => {
  beforeEach(() => vi.resetModules());

  it('queries jobs in processing state older than threshold and sets them to failed', async () => {
    const ltMock = vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [{ id: 'stuck-job-1' }, { id: 'stuck-job-2' }], error: null }),
    });
    const eqMock = vi.fn().mockReturnValue({ lt: ltMock });
    const updateMock = vi.fn().mockReturnValue({ eq: eqMock });

    vi.doMock('@/lib/insforge/server', () => ({
      getServerClient: vi.fn().mockReturnValue({
        database: { from: vi.fn().mockReturnValue({ update: updateMock }) },
      }),
    }));

    const { resetStuckProcessingJobs } = await import('@/lib/publish-queue');
    const count = await resetStuckProcessingJobs(10);

    expect(count).toBe(2);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', last_error: expect.stringContaining('stuck') })
    );
    expect(eqMock).toHaveBeenCalledWith('status', 'processing');
    expect(ltMock).toHaveBeenCalledWith('updated_at', expect.any(String));
  });

  it('returns 0 when no jobs are stuck', async () => {
    vi.doMock('@/lib/insforge/server', () => ({
      getServerClient: vi.fn().mockReturnValue({
        database: {
          from: vi.fn().mockReturnValue({
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                lt: vi.fn().mockReturnValue({
                  select: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }),
        },
      }),
    }));

    const { resetStuckProcessingJobs } = await import('@/lib/publish-queue');
    expect(await resetStuckProcessingJobs(10)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// P1-5: attempts counter — incremented exactly once per job execution
// ---------------------------------------------------------------------------
describe('P1-5: processPublishJob — attempts counter off-by-one fix', () => {
  beforeEach(() => vi.resetModules());

  it('sets attempts to job.attempts+1 exactly once when publish fails', async () => {
    const updateCalls: unknown[] = [];

    vi.doMock('@/lib/insforge/server', () => ({
      getServerClient: vi.fn().mockReturnValue({
        database: {
          from: vi.fn().mockReturnValue({
            update: vi.fn().mockImplementation((data: unknown) => {
              updateCalls.push(data);
              return { eq: vi.fn().mockResolvedValue({ error: null }) };
            }),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
          }),
        },
      }),
    }));
    vi.doMock('@/lib/social', () => ({
      getSocialProvider: vi.fn().mockReturnValue({
        name: 'ayrshare',
        publish: vi.fn().mockResolvedValue({ success: false, error: 'Rate limited' }),
      }),
    }));
    vi.doMock('@/lib/usage', () => ({ incrementUsage: vi.fn() }));
    vi.doMock('@/lib/logger', () => ({ logInfo: vi.fn(), logError: vi.fn() }));

    const { processPublishJob } = await import('@/lib/publish-queue');

    const job = {
      id: 'job-abc', user_id: 'u1', post_id: 'p1', platform: 'twitter' as const,
      status: 'queued' as const, idempotency_key: 'ik', scheduled_for: null,
      attempts: 1, max_attempts: 3, last_error: null,
      provider: 'ayrshare', provider_post_id: null, provider_url: null,
    };

    const result = await processPublishJob(job, { caption: 'content' });

    // attempts should be 2 (1+1), not 3 (1+1+1 from double-increment)
    expect(result.attempts).toBe(2);

    // The first DB update sets status to 'processing' with attempts=2
    const processingUpdate = updateCalls.find(
      (c) => (c as Record<string, unknown>).status === 'processing'
    ) as Record<string, unknown>;
    expect(processingUpdate?.attempts).toBe(2);

    // The failure update should NOT independently set attempts again
    const failureUpdate = updateCalls.find(
      (c) => (c as Record<string, unknown>).status === 'failed'
    ) as Record<string, unknown> | undefined;
    // Failure update only sets status + last_error, not attempts
    expect(failureUpdate?.attempts).toBeUndefined();
  });
});
