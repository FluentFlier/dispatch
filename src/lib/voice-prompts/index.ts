import { GHOSTWRITER_PRINCIPLES } from './principles';
import {
  PLATFORM_PLAYBOOKS,
  CONTENT_TYPE_HINTS,
  type VoicePlatform,
  type VoiceContentType,
} from './platforms';
import { ALL_TOP_HOOKS, HOOK_PATTERNS, getHookPattern, type HookVertical } from './hooks';

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

  // High-converting hook patterns (extracted via gstack from top performers)
  parts.push(`HIGH-CONVERTING HOOK PATTERNS (use these structures):
${ALL_TOP_HOOKS.map((h, i) => `${i + 1}. ${h}`).join('\n')}`);

  return parts.join('\n\n');
}

export { GHOSTWRITER_PRINCIPLES } from './principles';
export {
  PLATFORM_PLAYBOOKS,
  CONTENT_TYPE_HINTS,
  type VoicePlatform,
  type VoiceContentType,
} from './platforms';

export {
  ALL_TOP_HOOKS,
  HOOK_PATTERNS,
  getHookPattern,
  type HookVertical,
} from './hooks';
