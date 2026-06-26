import { getSocialProviderMode } from '@/lib/env';
import { unipileProvider } from '@/lib/social/unipile';
import { directProvider } from '@/lib/social/direct';
import type { SocialProvider } from '@/lib/social/types';

export function getSocialProvider(): SocialProvider {
  const mode = getSocialProviderMode();
  return mode === 'unipile' ? unipileProvider : directProvider;
}

export * from '@/lib/social/types';
