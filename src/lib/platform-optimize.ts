/**
 * Shared platform-optimization prompts.
 *
 * WHY shared: both the main generate flow (as an integrated "human polish"
 * final pass) and the cross-platform repurpose panel (/api/optimize) need the
 * exact same platform rules. Keeping one source of truth means the humaner
 * output users liked from the repurpose path is now what the main generator
 * produces too - no divergence, no duplicate maintenance.
 */

export type OptimizePlatform = 'twitter' | 'linkedin' | 'instagram' | 'threads';

export const PLATFORM_LIMITS: Record<OptimizePlatform, number> = {
  twitter: 280,
  linkedin: 3000,
  instagram: 2200,
  threads: 500,
};

/**
 * Build a platform-optimization prompt. `level` controls how aggressive the
 * rewrite is: 'light' preserves the original structure/length (good for a final
 * polish that must keep the drafted voice), 'full' fully adapts tone + format.
 */
export function buildPlatformOptimizationPrompt(
  platform: OptimizePlatform,
  content: string,
  level: 'light' | 'full',
): string {
  const intensity = level === 'light'
    ? 'Make minimal changes. Keep the original structure and tone as much as possible.'
    : 'Fully rewrite and optimize for this platform. Adapt tone, structure, and format.';

  switch (platform) {
    case 'twitter':
      return [
        `Optimize the following content for Twitter. ${intensity}`,
        '',
        'RULES:',
        '- Each tweet MUST be 280 characters or fewer.',
        '- If the content is short enough, write a single tweet.',
        '- If the content needs multiple tweets to cover properly, split into a thread.',
        '- Separate each tweet in a thread with the delimiter ---TWEET--- on its own line.',
        '- Each tweet in the thread must stand alone but connect to the narrative.',
        '- Use punchy, direct language. No filler.',
        '- No em dashes. Use hyphens or rewrite.',
        '- Do NOT include tweet numbering (1/, 2/, etc.) - just the content.',
        '',
        `ORIGINAL CONTENT:\n${content}`,
        '',
        'Write the optimized tweet(s). If multiple tweets, separate with ---TWEET--- on its own line.',
      ].join('\n');

    case 'linkedin':
      return [
        `Optimize the following content for LinkedIn. ${intensity}`,
        '',
        'RULES:',
        '- Maximum 3000 characters.',
        '- Professional but human tone.',
        '- Use line breaks for readability.',
        '- Start with a strong hook line.',
        '- End with a question or call to action to drive engagement.',
        '- No em dashes. Use hyphens or rewrite.',
        '',
        `ORIGINAL CONTENT:\n${content}`,
        '',
        'Write the optimized LinkedIn post.',
      ].join('\n');

    case 'instagram':
      return [
        `Optimize the following content as an Instagram caption. ${intensity}`,
        '',
        'RULES:',
        '- Maximum 2200 characters.',
        '- Caption format: hook line, body, then hashtags at the end.',
        '- Include 5-10 relevant hashtags at the bottom, separated from caption by two line breaks.',
        '- Conversational, authentic tone.',
        '- Use emojis sparingly if they fit.',
        '- No em dashes. Use hyphens or rewrite.',
        '',
        `ORIGINAL CONTENT:\n${content}`,
        '',
        'Write the optimized Instagram caption with hashtags.',
      ].join('\n');

    case 'threads':
      return [
        `Optimize the following content for Threads. ${intensity}`,
        '',
        'RULES:',
        '- Maximum 500 characters.',
        '- Conversational, casual tone.',
        '- Short and punchy.',
        '- Think of it like a text to a friend who is interested in this topic.',
        '- No em dashes. Use hyphens or rewrite.',
        '',
        `ORIGINAL CONTENT:\n${content}`,
        '',
        'Write the optimized Threads post.',
      ].join('\n');
  }
}
