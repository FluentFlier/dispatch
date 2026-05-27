import { getSocialProviderMode } from '@/lib/env';
import { ayrshareProvider } from '@/lib/social/ayrshare';
import { directProvider } from '@/lib/social/direct';
import type { SocialProvider } from '@/lib/social/types';

export function getSocialProvider(): SocialProvider {
  const mode = getSocialProviderMode();
  return mode === 'ayrshare' ? ayrshareProvider : directProvider;
}

export * from '@/lib/social/types';
