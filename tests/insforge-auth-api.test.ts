import { describe, it, expect } from 'vitest';
import {
  parseInsforgeTokenPayload,
  userFromAccessToken,
} from '@/lib/insforge-auth-api';

function makeJwt(expSec: number, sub = 'user-1'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, exp: expSec, email: 'a@b.com' })).toString('base64url');
  return `${header}.${payload}.sig`;
}

describe('insforge-auth-api', () => {
  it('parses camelCase token payloads', () => {
    const parsed = parseInsforgeTokenPayload({
      accessToken: 'at',
      refreshToken: 'rt',
      user: { id: 'u1', email: 'a@b.com' },
    });
    expect(parsed).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      user: { id: 'u1', email: 'a@b.com' },
    });
  });

  it('parses snake_case token payloads', () => {
    const parsed = parseInsforgeTokenPayload({
      access_token: 'at',
      refresh_token: 'rt',
    });
    expect(parsed?.accessToken).toBe('at');
    expect(parsed?.refreshToken).toBe('rt');
  });

  it('decodes user id from access token when user object missing', () => {
    const token = makeJwt(Math.floor(Date.now() / 1000) + 3600);
    const user = userFromAccessToken(token);
    expect(user?.id).toBe('user-1');
    expect(user?.email).toBe('a@b.com');
  });
});
