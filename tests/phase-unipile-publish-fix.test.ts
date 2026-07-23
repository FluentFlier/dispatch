/**
 * Phase: Unipile LinkedIn publish fix
 *
 * Regression: POST /api/v1/posts is a multipart/form-data endpoint. Sending
 * JSON (our old behaviour) produced a 400 "invalid_parameters" schema error.
 * This locks in that publish() now sends a FormData body with account_id + text
 * and does NOT force an application/json content-type.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('@/lib/insforge/server', () => ({
  getServerClient: vi.fn(),
}));

import { getServerClient } from '@/lib/insforge/server';
import { unipileProvider } from '@/lib/social/unipile';

function mockAccountRow(unipileAccountId: string | null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: unipileAccountId ? { unipile_account_id: unipileAccountId } : null,
    }),
  };
  (getServerClient as ReturnType<typeof vi.fn>).mockReturnValue({
    database: { from: vi.fn().mockReturnValue(chain) },
  });
}

beforeAll(() => {
  process.env.UNIPILE_DSN = 'api1.unipile.com:1234';
  process.env.UNIPILE_API_KEY = 'test-key';
});

beforeEach(() => vi.clearAllMocks());

describe('Phase: Unipile LinkedIn publish fix', () => {
  it('posts multipart FormData with account_id + text (not JSON)', async () => {
    mockAccountRow('acc_123');
    const fetchSpy = vi.fn()
      // Publishing first verifies the cached account id is still live.
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'acc_123',
        type: 'LINKEDIN',
        connection_params: { im: {} },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'post_1' }), { status: 201, headers: { 'content-type': 'application/json' } }),
      );
    vi.stubGlobal('fetch', fetchSpy);

    const res = await unipileProvider.publish('user_1', { platform: 'linkedin', text: 'hello world' });

    expect(res.success).toBe(true);
    expect(res.platformPostId).toBe('post_1');

    const [url, init] = fetchSpy.mock.calls[1];
    expect(String(url)).toContain('/api/v1/posts');
    expect(init.method).toBe('POST');
    // Body must be FormData, not a JSON string.
    expect(init.body).toBeInstanceOf(FormData);
    expect(typeof init.body).not.toBe('string');
    // Must NOT force JSON content-type (fetch sets the multipart boundary).
    const ct = (init.headers ?? {})['Content-Type'] ?? (init.headers ?? {})['content-type'];
    expect(ct).toBeUndefined();

    const body = init.body as FormData;
    expect(body.get('account_id')).toBe('acc_123');
    expect(body.get('text')).toBe('hello world');
    // No legacy media_urls field.
    expect(body.get('media_urls')).toBeNull();
  });

  it('fails cleanly when no Unipile account is connected', async () => {
    mockAccountRow(null);
    const res = await unipileProvider.publish('user_1', { platform: 'linkedin', text: 'hi' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('No Unipile account');
  });
});
