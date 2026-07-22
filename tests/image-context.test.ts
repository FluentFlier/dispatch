import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isOwnedImageKey, validateImageContextFile } from '@/lib/image-context';

vi.mock('@/lib/insforge/server', () => ({ getAuthenticatedUser: vi.fn(), getServerClient: vi.fn() }));
vi.mock('@/lib/llm', () => ({ describeImage: vi.fn() }));
vi.mock('@/lib/ai-guard', () => ({ guardAiRequest: vi.fn() }));

import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { describeImage } from '@/lib/llm';
import { guardAiRequest } from '@/lib/ai-guard';
import { NextRequest } from 'next/server';

describe('Write image context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_INSFORGE_URL = 'https://project.insforge.app';
    vi.mocked(guardAiRequest).mockResolvedValue({ ok: true });
  });

  it('accepts supported images and rejects unsupported or oversized files', () => {
    expect(validateImageContextFile({ type: 'image/png', size: 100 })).toBeNull();
    expect(validateImageContextFile({ type: 'image/svg+xml', size: 100 })).toMatch(/JPEG/);
    expect(validateImageContextFile({ type: 'image/png', size: 11 * 1024 * 1024 })).toMatch(/10MB/);
  });

  it('only trusts storage keys owned by the authenticated user', () => {
    expect(isOwnedImageKey('u1/123-a.png', 'u1')).toBe(true);
    expect(isOwnedImageKey('u2/123-a.png', 'u1')).toBe(false);
    expect(isOwnedImageKey('u1/../u2/a.png', 'u1')).toBe(false);
  });

  it('describes an authenticated, trusted upload', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'u1' } as never);
    vi.mocked(getServerClient).mockReturnValue({ storage: { from: () => ({ getPublicUrl: () => 'https://project.insforge.app/storage/post-media/u1/a.png' }) } } as never);
    vi.mocked(describeImage).mockResolvedValue('A person presenting beside a chart.');
    const { POST } = await import('@/app/api/generate/describe-image/route');
    const response = await POST(new NextRequest('http://localhost/api/generate/describe-image', {
      method: 'POST',
      body: JSON.stringify({ key: 'u1/a.png' }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ description: 'A person presenting beside a chart.' });
    expect(guardAiRequest).toHaveBeenCalledWith('u1');
  });

  it('blocks vision calls when the account quota is exhausted', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'u1' } as never);
    vi.mocked(guardAiRequest).mockResolvedValue({ ok: false, status: 402, error: 'AI generation limit reached.' });
    const { POST } = await import('@/app/api/generate/describe-image/route');
    const response = await POST(new NextRequest('http://localhost/api/generate/describe-image', {
      method: 'POST',
      body: JSON.stringify({ key: 'u1/a.png' }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(402);
    expect(describeImage).not.toHaveBeenCalled();
  });

  it('blocks arbitrary URLs before invoking vision', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'u1' } as never);
    const { POST } = await import('@/app/api/generate/describe-image/route');
    const response = await POST(new NextRequest('http://localhost/api/generate/describe-image', {
      method: 'POST',
      body: JSON.stringify({ key: 'u2/private.png' }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(400);
    expect(describeImage).not.toHaveBeenCalled();
  });
});
