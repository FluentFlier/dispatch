import { describe, it, expect } from 'vitest';
import { isJwtExpired, decodeJwtExpSec } from '@/lib/auth-cookies';

function makeJwt(expSec: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'user-1', exp: expSec })).toString('base64url');
  return `${header}.${payload}.sig`;
}

describe('auth-cookies', () => {
  it('detects expired JWT with skew', () => {
    const expired = makeJwt(Math.floor(Date.now() / 1000) - 120);
    expect(isJwtExpired(expired)).toBe(true);
  });

  it('treats valid JWT as not expired', () => {
    const valid = makeJwt(Math.floor(Date.now() / 1000) + 3600);
    expect(isJwtExpired(valid)).toBe(false);
  });

  it('returns null exp for opaque tokens', () => {
    expect(decodeJwtExpSec('opaque-token')).toBeNull();
    expect(isJwtExpired('opaque-token')).toBe(false);
  });
});

describe('middleware — expired JWT refresh redirect', () => {
  it('redirects protected routes with expired JWT + refresh cookie to /api/auth/refresh', async () => {
    const { middleware } = await import('@/middleware');
    const { NextRequest } = await import('next/server');
    const expired = makeJwt(Math.floor(Date.now() / 1000) - 60);

    const request = new NextRequest('http://localhost/dashboard', {
      headers: {
        cookie: `content-os-token=${expired}; content-os-refresh=rt_abc`,
      },
    });

    const response = await middleware(request);
    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('/api/auth/refresh');
    expect(location).toContain('next=%2Fdashboard');
  });

  it('redirects expired JWT without refresh cookie to restore-session', async () => {
    const { middleware } = await import('@/middleware');
    const { NextRequest } = await import('next/server');
    const expired = makeJwt(Math.floor(Date.now() / 1000) - 60);

    const request = new NextRequest('http://localhost/inbox', {
      headers: { cookie: `content-os-token=${expired}` },
    });

    const response = await middleware(request);
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/auth/restore-session');
  });

  it('does not redirect valid JWT on protected routes', async () => {
    const { middleware } = await import('@/middleware');
    const { NextRequest } = await import('next/server');
    const valid = makeJwt(Math.floor(Date.now() / 1000) + 3600);

    const request = new NextRequest('http://localhost/dashboard', {
      headers: { cookie: `content-os-token=${valid}` },
    });

    const response = await middleware(request);
    expect(response.status).not.toBe(307);
  });
});
