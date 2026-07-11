/**
 * Shared cross-platform optimize logic used by:
 * - POST /api/optimize (user session)
 * - triggerAutoOptimize (in-process background, no HTTP round-trip)
 */

import { generateContent, type CreatorProfileForPrompt } from '@/lib/ai';
import { buildPlatformOptimizationPrompt, PLATFORM_LIMITS } from '@/lib/platform-optimize';
import type { OptimizePlatform } from '@/lib/platform-optimize';

export type { OptimizePlatform };

export interface OptimizeVariant {
  platform: OptimizePlatform;
  content: string;
  characterCount: number;
  isThread: boolean;
  threadParts: string[] | null;
}

export interface OptimizeVariantsResult {
  variants: OptimizeVariant[];
  errors: { platform: OptimizePlatform; error: string }[];
}

function splitIntoTweets(text: string): string[] {
  const maxLen = 280;
  const tweets: string[] = [];
  let remaining = text.trim();

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      tweets.push(remaining);
      break;
    }

    let splitIndex = -1;
    const sentenceEnders = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
    for (const ender of sentenceEnders) {
      const idx = remaining.lastIndexOf(ender, maxLen - 1);
      if (idx > 0 && idx > splitIndex) {
        splitIndex = idx + ender.length - 1;
      }
    }

    if (splitIndex <= 0) {
      splitIndex = remaining.lastIndexOf(' ', maxLen - 1);
    }

    if (splitIndex <= 0) {
      splitIndex = maxLen;
    }

    tweets.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  return tweets;
}

function truncateToLimit(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cutoff = limit - 1;
  const lastSpace = text.lastIndexOf(' ', cutoff);
  if (lastSpace > limit * 0.5) {
    return text.slice(0, lastSpace).trimEnd() + '\u2026';
  }
  return text.slice(0, cutoff) + '\u2026';
}

function processTwitterContent(content: string): OptimizeVariant {
  const trimmed = content.trim();

  if (trimmed.includes('---TWEET---')) {
    let parts = trimmed
      .split('---TWEET---')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const validatedParts: string[] = [];
    for (const part of parts) {
      if (part.length <= 280) {
        validatedParts.push(part);
      } else {
        validatedParts.push(...splitIntoTweets(part));
      }
    }
    parts = validatedParts;

    if (parts.length > 1) {
      const joined = parts.join('\n---TWEET---\n');
      return {
        platform: 'twitter',
        content: joined,
        characterCount: joined.length,
        isThread: true,
        threadParts: parts,
      };
    }
  }

  if (trimmed.length <= 280) {
    return {
      platform: 'twitter',
      content: trimmed,
      characterCount: trimmed.length,
      isThread: false,
      threadParts: null,
    };
  }

  const parts = splitIntoTweets(trimmed);
  return {
    platform: 'twitter',
    content: parts.join('\n---TWEET---\n'),
    characterCount: parts.join('\n---TWEET---\n').length,
    isThread: true,
    threadParts: parts,
  };
}

function processStandardContent(
  platform: OptimizePlatform,
  content: string,
): OptimizeVariant {
  const trimmed = content.trim();
  const limit = PLATFORM_LIMITS[platform];
  const truncated = truncateToLimit(trimmed, limit);
  return {
    platform,
    content: truncated,
    characterCount: truncated.length,
    isThread: false,
    threadParts: null,
  };
}

/**
 * Generate platform-optimized variants for the given content.
 * Caller is responsible for auth, AI budget guards, and voice context loading.
 */
export async function generateOptimizeVariants(params: {
  content: string;
  targetPlatforms: OptimizePlatform[];
  optimizationLevel: 'light' | 'full';
  profile: CreatorProfileForPrompt | null;
  contextAdditions?: string;
}): Promise<OptimizeVariantsResult> {
  const { content, targetPlatforms, optimizationLevel, profile, contextAdditions } = params;
  const variants: OptimizeVariant[] = [];
  const errors: { platform: OptimizePlatform; error: string }[] = [];

  for (const platform of targetPlatforms) {
    try {
      const prompt = buildPlatformOptimizationPrompt(platform, content, optimizationLevel);
      const generated = await generateContent(
        prompt,
        contextAdditions || undefined,
        undefined,
        profile,
      );

      const cleaned = generated.replace(/\u2014/g, ' - ').replace(/\u2013/g, '-');

      if (platform === 'twitter') {
        variants.push(processTwitterContent(cleaned));
      } else {
        variants.push(processStandardContent(platform, cleaned));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Generation failed';
      errors.push({ platform, error: message });
    }
  }

  return { variants, errors };
}
