'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { SkeletonLines } from '@/components/ui/Skeleton';
import { fetchWithAuth } from '@/lib/fetch-with-auth';

const PLATFORM_CONSTRAINTS: Record<string, string> = {
  instagram: 'Instagram comment. Short, conversational. No em dashes.',
  twitter: 'X/Twitter reply. Under 280 characters unless clearly a thread reply.',
  linkedin: 'LinkedIn comment. Professional but still in the creator\'s voice.',
  threads: 'Threads reply. Casual and brief.',
};

async function callGenerate(
  prompt: string,
  opts: { contentType?: string; fast?: boolean } = {},
): Promise<string> {
  const res = await fetchWithAuth('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, ...opts }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Generation failed');
  }
  const { text } = await res.json();
  return text;
}

/**
 * Parses model output into one reply per comment. Prefers a JSON array; falls
 * back to REPLY-marker blocks so a single comment is never silently dropped.
 */
function parseReplies(text: string, commentLines: string[]): { comment: string; reply: string }[] {
  // Preferred: a JSON array of reply strings.
  try {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const arr = JSON.parse(match[0]);
      if (Array.isArray(arr) && arr.length > 0) {
        return commentLines.map((c, i) => ({
          comment: c || `Comment ${i + 1}`,
          reply: arr[i] != null ? String(arr[i]).trim() : '(no reply generated)',
        }));
      }
    }
  } catch {
    // fall through to marker parsing
  }

  // Fallback: split on REPLY N: markers (survives even if COMMENT markers were stripped).
  const replyBlocks = text
    .split(/REPLY\s*\d+:\s*/i)
    .slice(1)
    .map((b) => b.split(/COMMENT\s*\d+:/i)[0].trim())
    .filter(Boolean);
  if (replyBlocks.length > 0) {
    return commentLines.map((c, i) => ({
      comment: c || `Comment ${i + 1}`,
      reply: replyBlocks[i]?.trim() || '(no reply generated)',
    }));
  }

  // Last resort: single comment → whole text is the reply.
  return [{ comment: commentLines[0] || 'Comment 1', reply: text.trim() }];
}

export function CommentReplies() {
  const [comments, setComments] = useState('');
  const [platform, setPlatform] = useState('instagram');
  const [replies, setReplies] = useState<{ comment: string; reply: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    if (loading) return; // guard against double-submit
    if (!comments.trim()) {
      setError('Paste some comments first');
      return;
    }
    setLoading(true);
    setError('');
    setReplies([]);

    const commentLines = comments.trim().split('\n').filter((l) => l.trim());
    const platformConstraint = PLATFORM_CONSTRAINTS[platform] || PLATFORM_CONSTRAINTS.instagram;

    const prompt = `Write one reply per comment below, in the creator's voice (use their voice from your system context), not a generic brand account.

PLATFORM: ${platformConstraint}

COMMENTS (reply to each, in order):
${commentLines.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Return ONLY a JSON array of strings — exactly one reply per comment, in the same order. Example: ["first reply", "second reply"]. No other text, no markdown.`;

    try {
      // fast mode: skip the revise/humanize passes so the JSON array survives intact.
      const text = await callGenerate(prompt, { contentType: 'reply', fast: true });
      setReplies(parseReplies(text, commentLines));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Platform selector */}
      <div className="flex gap-2">
        {Object.keys(PLATFORM_CONSTRAINTS).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPlatform(p)}
            className={`px-3 py-1.5 rounded-[5px] text-[12px] font-medium capitalize transition-colors ${
              platform === p
                ? 'bg-bg-tertiary text-text-primary'
                : 'text-text-secondary hover:text-text-tertiary'
            }`}
          >
            {p === 'twitter' ? 'X' : p}
          </button>
        ))}
      </div>

      <div>
        <label className="block section-label mb-2">
          Paste comments (one per line)
        </label>
        <textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          rows={6}
          placeholder={`Paste ${platform} comments here, one per line...`}
          className="w-full bg-bg-tertiary border border-border rounded-md px-4 py-3 font-body text-[13px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover resize-none transition-colors duration-100"
        />
      </div>

      <Button onClick={generate} loading={loading} disabled={!comments.trim()}>
        Generate Replies
      </Button>

      {error && <p className="font-body text-[13px] text-red-400">{error}</p>}

      {loading && (
        <div className="bg-bg-tertiary border border-border rounded-lg p-[13px_14px]">
          <SkeletonLines count={4} />
        </div>
      )}

      {replies.length > 0 && (
        <div className="space-y-3">
          {replies.map((pair, i) => (
            <div
              key={i}
              className="bg-bg-tertiary border border-border rounded-lg p-4 space-y-2"
            >
              {/* Original comment */}
              <div className="flex items-start gap-2">
                <span className="font-mono text-[10px] tracking-[0.08em] uppercase text-ink3 shrink-0 mt-0.5">
                  Comment
                </span>
                <p className="font-body text-[12px] text-text-secondary leading-relaxed flex-1">
                  {pair.comment}
                </p>
              </div>
              {/* Generated reply */}
              <div className="flex items-start gap-2 pt-2 border-t border-border">
                <span className="font-mono text-[10px] tracking-[0.08em] uppercase text-flame shrink-0 mt-0.5">
                  Reply
                </span>
                <p className="font-body text-[13px] text-text-primary leading-[1.55] flex-1">
                  {pair.reply}
                </p>
                <CopyButton text={pair.reply} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
