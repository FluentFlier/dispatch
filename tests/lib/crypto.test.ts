import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { encryptToken, decryptToken } from '@/lib/crypto';

describe('crypto (AES-256-GCM token encryption)', () => {
  beforeEach(() => {
    // 64 hex chars = 32 bytes
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'a'.repeat(64));
    vi.stubEnv('NODE_ENV', 'production');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('round-trips a token', () => {
    const secret = 'oauth-access-token-123';
    const enc = encryptToken(secret);
    expect(enc).not.toBe(secret);
    expect(enc.split(':')).toHaveLength(3);
    expect(decryptToken(enc)).toBe(secret);
  });

  it('uses a random IV so the same plaintext encrypts differently', () => {
    expect(encryptToken('same-input')).not.toBe(encryptToken('same-input'));
  });

  it('round-trips unicode and multiline content', () => {
    const s = 'café 🚀 multi\nline secret';
    expect(decryptToken(encryptToken(s))).toBe(s);
  });

  it('rejects tampered ciphertext (GCM auth tag fails)', () => {
    const enc = encryptToken('tamper-me');
    const [iv, , tag] = enc.split(':');
    const forged = Buffer.from('totally-different-bytes').toString('base64');
    expect(() => decryptToken([iv, forged, tag].join(':'))).toThrow();
  });
});
