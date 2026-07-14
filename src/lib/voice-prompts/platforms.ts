/**
 * Short platform playbooks for native formatting.
 */

export type VoicePlatform = 'twitter' | 'linkedin' | 'instagram' | 'threads';
export type VoiceContentType = 'post' | 'thread' | 'reply' | 'comment' | 'hooks' | 'caption';

export const PLATFORM_PLAYBOOKS: Record<VoicePlatform, string> = {
  twitter: `TWITTER / X
- Hook in first line; thread only if the brief requires depth.
- 280 chars per tweet unless long-form is requested.
- Line breaks for scanability; no hashtag spam (0 to 2 max).
- Replies: direct, no preamble; match the tone of the parent post.`,

  linkedin: `LINKEDIN
- Strong first line before "see more" fold; no "I'm excited to announce".
- Full post length: 200 to 400 words minimum. Not a script outline. Developed paragraphs with context, story, stakes, and takeaway.
- Paragraphs are 2 to 4 sentences of connected prose, double line break between them for white space. The ONLY one-sentence paragraphs allowed are the opening hook line and the closing CTA question - every other paragraph must merge its sentences into one flowing block, not one sentence per line.
- Professional but human: story beats credentials list.
- Structure (write as connected prose, not labeled sections): hook line, setup (2-3 sentences in one paragraph), story or data (2-4 sentences in one paragraph), insight (2-3 sentences in one paragraph), CTA question.
- Comments: add value, not "+1" energy; one clear takeaway.`,

  instagram: `INSTAGRAM
- Caption hook in first 125 chars; emoji only if the creator uses them.
- Script/caption split: spoken rhythm for Reels, scannable lines for feed.
- Hashtags at end (3 to 8) unless brief says otherwise.
- CTA: save, share, or comment prompt to match post type.`,

  threads: `THREADS
- Conversational, slightly looser than LinkedIn.
- 500 char soft cap per post; break long thoughts across replies.
- Questions and opinions welcome; avoid corporate polish.
- Replies: warm, brief, like a group chat, not a press release.`,
};

export const CONTENT_TYPE_HINTS: Record<VoiceContentType, string> = {
  post: 'Primary post: full structure, native length, one clear CTA.',
  thread:
    'THREAD MODE (X/Twitter thread). Write 5 to 9 tweets. Each tweet carries ONE idea and MUST be 280 characters or fewer. Separate tweets with a line containing only --- (three hyphens, nothing else on the line). The first tweet is the hook and must work standalone; the final tweet lands the takeaway with a soft CTA. No numbering required, no hashtag spam.',
  reply: 'Reply: respond to the specific point; no re-introduction of the creator.',
  comment: 'Comment: 1 to 3 sentences max; helpful or witty, never preachy.',
  hooks:
    'LIST MODE (the brief asks for a list - this is allowed). Output ONLY a numbered list of distinct one-line hooks, exactly as many as the brief requests. Each hook is ONE short sentence on its own line, prefixed "1." through "N.". Do NOT write a paragraph or a full post; ignore full-post length rules. No intro, no explanation, no closing line.',
  caption:
    'CAPTION MODE. Output the caption first (tight, scannable), then a blank line, then ONE final line of space-separated hashtags. Always include the hashtag line. No section labels, no commentary.',
};
