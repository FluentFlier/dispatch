import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/entitlements', () => ({
  assertCanGenerate: vi.fn(),
}));
vi.mock('@/lib/usage', () => ({
  incrementUsage: vi.fn().mockResolvedValue(undefined),
}));

import { guardAiRequest } from '@/lib/ai-guard';
import { assertCanGenerate } from '@/lib/entitlements';
import { incrementUsage } from '@/lib/usage';

describe('guardAiRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertCanGenerate).mockResolvedValue({ ok: true } as never);
  });

  it('allows a normal request and records one ai_generate unit', async () => {
    const r = await guardAiRequest('user-allow');
    expect(r.ok).toBe(true);
    expect(incrementUsage).toHaveBeenCalledWith('user-allow', 'ai_generate', 1);
  });

  it('blocks with 402 when the monthly plan cap is reached', async () => {
    vi.mocked(assertCanGenerate).mockResolvedValue({ ok: false, error: 'cap reached' } as never);
    const r = await guardAiRequest('user-cap');
    expect(r).toMatchObject({ ok: false, status: 402 });
    expect(incrementUsage).not.toHaveBeenCalled();
  });

  it('blocks with 429 once the burst limit is exceeded in a window', async () => {
    const uid = 'user-burst';
    const results = [];
    for (let i = 0; i < 20; i++) results.push(await guardAiRequest(uid));
    expect(results.slice(0, 15).every((r) => r.ok)).toBe(true);
    const blocked = results.filter((r) => !r.ok && (r as { status: number }).status === 429);
    expect(blocked.length).toBe(5);
  });
});
