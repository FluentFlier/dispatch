/**
 * Phase: Auth - OAuth exchange must not burn the single-use code.
 * A definitive 4xx from the first client_type attempt (PKCE mismatch,
 * consumed code) means the code is dead; retrying with another client_type
 * only produces a misleading "Invalid or expired code" (the exact log pair
 * seen in production: server 400 "PKCE verification failed" then mobile 400
 * "Invalid or expired code" 40ms later). Transport/5xx failures may retry.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exchangeOAuthCodeViaApi } from '@/lib/insforge-auth-api';

function stubFetchSequence(responses: Array<{ status: number } | 'network'>) {
  let call = 0;
  const fn = vi.fn().mockImplementation(() => {
    const r = responses[Math.min(call++, responses.length - 1)];
    if (r === 'network') return Promise.reject(new Error('ECONNRESET'));
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () =>
        r.status < 300
          ? { accessToken: 'at', refreshToken: 'rt' }
          : { error: 'AUTH_UNAUTHORIZED', message: 'PKCE verification failed' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_INSFORGE_URL', 'https://test.insforge.app');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('exchangeOAuthCodeViaApi', () => {
  it('succeeds on the first client_type without a second call', async () => {
    const fetchFn = stubFetchSequence([{ status: 200 }]);
    const payload = await exchangeOAuthCodeViaApi('code1', 'verifier');
    expect(payload?.refreshToken).toBe('rt');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('stops after a definitive 4xx instead of replaying the consumed code', async () => {
    const fetchFn = stubFetchSequence([{ status: 400 }]);
    const payload = await exchangeOAuthCodeViaApi('code1', 'verifier');
    expect(payload).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toContain('client_type=server');
  });

  it('still falls back to mobile on transport errors (code may be live)', async () => {
    const fetchFn = stubFetchSequence(['network', { status: 200 }]);
    const payload = await exchangeOAuthCodeViaApi('code1', 'verifier');
    expect(payload?.refreshToken).toBe('rt');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[1][0]).toContain('client_type=mobile');
  });

  it('falls back to mobile on 5xx', async () => {
    const fetchFn = stubFetchSequence([{ status: 503 }, { status: 200 }]);
    const payload = await exchangeOAuthCodeViaApi('code1', 'verifier');
    expect(payload?.refreshToken).toBe('rt');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
