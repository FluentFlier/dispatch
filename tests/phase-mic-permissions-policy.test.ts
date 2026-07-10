/**
 * Regression: the app-wide Permissions-Policy header must allow the microphone
 * for the same origin. A `microphone=()` (empty allowlist) blocks getUserMedia
 * site-wide BEFORE any permission prompt and cannot be overridden by the user
 * manually allowing the mic in site settings, which broke Dictate and the Voice
 * Capture recorder. camera/geolocation stay locked (unused by the app).
 */
import { describe, it, expect } from 'vitest';
import nextConfig from '../next.config.mjs';

async function permissionsPolicyValue(): Promise<string> {
  const rules = await nextConfig.headers!();
  const header = rules
    .flatMap((r) => r.headers)
    .find((h) => h.key === 'Permissions-Policy');
  if (!header) throw new Error('Permissions-Policy header not found');
  return header.value;
}

describe('Permissions-Policy microphone', () => {
  it('allows the microphone for the same origin', async () => {
    const value = await permissionsPolicyValue();
    // self = same-origin allowed. Empty allowlist microphone=() blocks it entirely.
    expect(value).toMatch(/microphone=\(self\)/);
    expect(value).not.toMatch(/microphone=\(\)/);
  });

  it('keeps camera and geolocation locked (unused features)', async () => {
    const value = await permissionsPolicyValue();
    expect(value).toMatch(/camera=\(\)/);
    expect(value).toMatch(/geolocation=\(\)/);
  });
});
