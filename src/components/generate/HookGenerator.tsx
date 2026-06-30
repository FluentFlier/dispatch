'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { SkeletonLines } from '@/components/ui/Skeleton';
import { fetchWithAuth } from '@/lib/fetch-with-auth';

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
 * Splits a generation result into individual hooks. Prefers numbered lines, but
 * falls back to non-empty lines / sentences so a stray paragraph never collapses
 * into a single "hook card".
 */
function parseHooks(text: string): string[] {
  const trimFirstSentence = (s: string): string => {
    const cuts = ['. ', '! ', '? '].map((p) => s.indexOf(p)).filter((i) => i > 20);
    const cutAt = cuts.length > 0 ? Math.min(...cuts) + 1 : -1;
    return (cutAt > 0 ? s.slice(0, cutAt) : s.slice(0, 200)).trim();
  };

  const numbered = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\d+[.)]/.test(l))
    .map((l) => trimFirstSentence(l.replace(/^\d+[.)]\s*/, '')))
    .filter((l) => l.length > 5);
  if (numbered.length > 1) return numbered;

  // Fallback 1: any non-empty lines (model dropped the numbering).
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 5)
    .map(trimFirstSentence);
  if (lines.length > 1) return lines;

  // Fallback 2: one blob — split into sentences so the user still gets options.
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
  return sentences.length > 1 ? sentences : [text.trim()];
}

/**
 * Strips a leading @ from a social handle string.
 * Handles any type since intelHooks is typed as any[].
 */
function stripLeadingAt(author: unknown): string {
  const s = String(author ?? '');
  return s.startsWith('@') ? s.slice(1) : s;
}

export function HookGenerator() {
  const [topic, setTopic] = useState('');
  const [hooks, setHooks] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Live RAG + RL hooks from the intelligence engine (GStack mined + trained)
  const [intelHooks, setIntelHooks] = useState<any[]>([]);
  const [intelLoading, setIntelLoading] = useState(true);

  useEffect(() => {
    fetch('/api/hooks/intelligence?limit=6')
      .then(r => r.ok ? r.json() : { hooks: [] })
      .then(d => setIntelHooks(d.hooks || []))
      .finally(() => setIntelLoading(false));
  }, []);

  const generate = async () => {
    if (loading) return; // guard against double-submit (React strict-mode / fast double-click)
    setLoading(true);
    setError('');
    setHooks([]);
    const topicStr =
      topic.trim() || 'the creator\'s main content topics';
    const prompt = `Generate 8 Instagram hooks for: ${topicStr}.
One sentence each. First word must stop the scroll.
Mix styles:
- Stat-based: use a real number or achievement from the creator's context
- Contrarian: challenge a common assumption in the creator's space
- Story-drop: drop into a specific moment from the creator's experience
- Challenge: call out something the audience is doing wrong
- Curiosity: tease something surprising the creator has learned
- Vulnerability: share a real struggle or near-failure
Numbered 1-8. One per line. No explanation. No em dashes.`;
    try {
      // hooks content type + fast mode: produces a clean numbered list and skips
      // the revise loop that previously reshaped hooks into one paragraph.
      const text = await callGenerate(prompt, { contentType: 'hooks', fast: true });
      setHooks(parseHooks(text));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="block section-label mb-2">
          Topic (optional)
        </label>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Leave blank for general hooks or enter a topic..."
          className="w-full bg-bg-tertiary border border-border rounded-md px-4 py-3 font-body text-[13px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover transition-colors duration-100"
        />
      </div>

      <Button onClick={generate} loading={loading}>
        Generate 8 Hooks
      </Button>

      {error && <p className="font-body text-[13px] text-accent-primary">{error}</p>}

      {loading && (
        <div className="bg-bg-tertiary border border-border rounded-lg p-[13px_14px]">
          <SkeletonLines count={3} />
        </div>
      )}

      {hooks.length > 0 && (
        <div className="bg-bg-tertiary border border-border rounded-lg p-[13px_14px] space-y-2">
          {hooks.map((hook, i) => (
            <div
              key={i}
              className="flex items-start justify-between gap-3 py-2 border-b border-border last:border-0"
            >
              <p className="font-body text-[13px] text-text-primary flex-1 leading-[1.55]">
                <span className="text-text-secondary font-medium mr-2">
                  {i + 1}.
                </span>
                {hook}
              </p>
              <CopyButton text={hook} />
            </div>
          ))}
        </div>
      )}

      {/* Live Intelligence Hooks (RAG + RL from GStack mined data) - makes research -> generate working */}
      <div className="mt-4">
        <div className="text-[12px] font-medium text-text-secondary mb-2 flex items-center gap-2">
          Or use live high-converting hooks from your Intelligence (RAG + RL trained)
          {intelLoading && <span className="text-[10px]">(loading...)</span>}
        </div>
        {intelHooks.length > 0 ? (
          <div className="bg-bg-tertiary border border-border rounded-lg p-[13px_14px] space-y-2 text-sm">
            {intelHooks.slice(0, 5).map((h, i) => (
              <div key={i} className="flex items-start justify-between gap-2 py-1 border-b border-border last:border-0">
                <p className="flex-1 text-text-primary">
                  {'"'}{h.text}{'"'}{' '}
                  <span className="text-text-secondary">(@{stripLeadingAt(h.author)})</span>
                </p>
                <CopyButton text={h.text} />
              </div>
            ))}
          </div>
        ) : !intelLoading && (
          <div className="text-xs text-text-tertiary">Run more GStack mining or research to populate your personal high-converting hook library.</div>
        )}
      </div>
    </div>
  );
}
