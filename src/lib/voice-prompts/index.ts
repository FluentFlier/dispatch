import { GHOSTWRITER_PRINCIPLES } from './principles';
import {
  PLATFORM_PLAYBOOKS,
  CONTENT_TYPE_HINTS,
  type VoicePlatform,
  type VoiceContentType,
} from './platforms';

const VALID_PLATFORMS = new Set<string>(['twitter', 'linkedin', 'instagram', 'threads']);

/**
 * Composable hints appended to the voice pipeline system context.
 */
export function buildVoiceComposeHints(
  platform?: string,
  contentType: VoiceContentType = 'post',
): string {
  const parts: string[] = [GHOSTWRITER_PRINCIPLES];

  if (platform && VALID_PLATFORMS.has(platform)) {
    parts.push(PLATFORM_PLAYBOOKS[platform as VoicePlatform]);
  }

  parts.push(`CONTENT TYPE: ${CONTENT_TYPE_HINTS[contentType]}`);

  return parts.join('\n\n');
}

export { GHOSTWRITER_PRINCIPLES } from './principles';
export {
  PLATFORM_PLAYBOOKS,
  CONTENT_TYPE_HINTS,
  type VoicePlatform,
  type VoiceContentType,
} from './platforms';
