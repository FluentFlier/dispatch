import { GHOSTWRITER_PRINCIPLES } from './principles';
import {
  PLATFORM_PLAYBOOKS,
  CONTENT_TYPE_HINTS,
  type VoicePlatform,
  type VoiceContentType,
} from './platforms';
import { ALL_TOP_HOOKS, HOOK_PATTERNS, getHookPattern, type HookVertical } from './hooks';
import {
  POST_CRAFT_PRINCIPLES,
  HOOK_FORMULAS,
  THREAD_HOOK_FORMULAS,
  COMMENT_CRAFT,
} from './exemplars';

const VALID_PLATFORMS = new Set<string>(['twitter', 'linkedin', 'instagram', 'threads']);

export interface ComposeHintOptions {
  /**
   * The creator's own opening style (structural_patterns.hook_pattern from
   * Voice Lab). When present it REPLACES the generic viral hook templates -
   * generic hooks homogenize output across users (audit P0-3).
   */
  creatorHookPattern?: string;
}

/**
 * Composable hints appended to the voice pipeline system context.
 */
export function buildVoiceComposeHints(
  platform?: string,
  contentType: VoiceContentType = 'post',
  options: ComposeHintOptions = {},
): string {
  const parts: string[] = [GHOSTWRITER_PRINCIPLES];

  if (platform && VALID_PLATFORMS.has(platform)) {
    parts.push(PLATFORM_PLAYBOOKS[platform as VoicePlatform]);
  }

  // Craft principles apply to full posts and threads, where structure carries
  // the piece. Comments/replies/hooks/captions have their own tighter hints.
  if (contentType === 'post' || contentType === 'thread') {
    parts.push(POST_CRAFT_PRINCIPLES);
  }

  parts.push(`CONTENT TYPE: ${CONTENT_TYPE_HINTS[contentType]}`);

  if (contentType === 'comment' || contentType === 'reply') {
    parts.push(COMMENT_CRAFT);
  }

  const creatorPattern = options.creatorHookPattern?.trim();
  const wantsHookGuidance = contentType !== 'comment' && contentType !== 'reply';
  if (creatorPattern) {
    parts.push(
      `OPENING (authoritative): Open the post the way THIS creator opens: ${creatorPattern}\nDo not use generic viral hook templates.`,
    );
  } else if (wantsHookGuidance && contentType === 'thread') {
    parts.push(THREAD_HOOK_FORMULAS);
  } else if (wantsHookGuidance) {
    parts.push(HOOK_FORMULAS);
    parts.push(`HOOK PATTERNS (optional inspiration - adapt the structure to this topic, never copy topics):
${ALL_TOP_HOOKS.slice(0, 5).map((h, i) => `${i + 1}. ${h}`).join('\n')}`);
  }

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

export {
  POST_CRAFT_PRINCIPLES,
  HOOK_FORMULAS,
  THREAD_HOOK_FORMULAS,
  COMMENT_CRAFT,
} from './exemplars';
