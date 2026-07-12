/**
 * Phase: Feedback Ops - Langfuse wrapper no-op guarantees (spec 4.2).
 * Without LANGFUSE_PUBLIC_KEY/SECRET_KEY the feature must no-op LOUDLY ONCE
 * and NEVER crash: withSpan is a transparent passthrough, flush is inert.
 * (Vitest env has no keys, so this exercises the exact prod-missing-keys path.)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { langfuseEnabled, withSpan, flushAfterResponse } from '@/lib/observability/langfuse';

describe('langfuse wrapper without keys', () => {
  beforeEach(() => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
  });

  it('reports disabled', () => {
    expect(langfuseEnabled()).toBe(false);
  });

  it('withSpan passes the return value through untouched', async () => {
    const out = await withSpan('test', { model: 'x' }, async () => ({ text: 'hello', n: 3 }));
    expect(out).toEqual({ text: 'hello', n: 3 });
  });

  it('withSpan propagates errors (never swallows pipeline failures)', async () => {
    await expect(withSpan('test', {}, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });

  it('flushAfterResponse never throws', () => {
    expect(() => flushAfterResponse()).not.toThrow();
  });

  it('enabled when both keys present', () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk';
    process.env.LANGFUSE_SECRET_KEY = 'sk';
    expect(langfuseEnabled()).toBe(true);
  });
});
