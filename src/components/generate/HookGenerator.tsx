'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { SkeletonLines } from '@/components/ui/Skeleton';

async function callGenerate(prompt: string): Promise<string> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Generation failed');
  }
  const { text } = await res.json();
  return text;
}

export function HookGenerator() {
  const [topic, setTopic] = useState('');
  const [hooks, setHooks] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
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
      const text = await callGenerate(prompt);
      const lines = text
        .split('\n')
        .map((l: string) => l.trim())
        .filter((l: string) => /^\d/.test(l))
        .map((l: string) => l.replace(/^\d+[\.\)]\s*/, ''));
      setHooks(lines.length > 0 ? lines : [text]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="block font-body text-[13px] text-text-tertiary mb-2">
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
    </div>
  );
}
