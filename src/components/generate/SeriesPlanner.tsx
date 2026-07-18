'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { GenerateOutput } from './GenerateOutput';
import { getInsforgeClient } from '@/lib/insforge/client';
import type { Pillar, Platform } from '@/types/database';
import { fetchWithAuth } from '@/lib/fetch-with-auth';

async function callGenerate(prompt: string): Promise<string> {
  const res = await fetchWithAuth('/api/generate', {
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

export function SeriesPlanner() {
  const [concept, setConcept] = useState('');
  const [numParts, setNumParts] = useState(5);
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const generate = async () => {
    if (loading) return; // guard against double-submit
    if (!concept.trim()) {
      setError('Enter a series concept');
      return;
    }
    setLoading(true);
    setError('');
    setOutput('');
    setSaved(false);
    const prompt = `Plan a ${numParts}-part Instagram content series on: ${concept.trim()}.
For each part:
PART [n]:
TITLE: (punchy episode title)
HOOK: (first line on camera)
CORE POINT: (what this part establishes -- one sentence)
CLIFFHANGER/BRIDGE: (how this part makes them want the next one)

Each part works standalone but rewards watching all. Part 1 must be the strongest hook. Build toward a payoff. The creator's voice throughout. No em dashes.`;
    try {
      const text = await callGenerate(prompt);
      setOutput(text);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  const saveSeries = async () => {
    if (!output) return;
    setSaving(true);
    setError('');
    try {
      const insforge = getInsforgeClient();
      const { data: userData } = await insforge.auth.getCurrentUser();
      if (!userData?.user) throw new Error('Not logged in');

      const { data: series, error: seriesErr } = await insforge.database
        .from('series')
        .insert([{
          user_id: userData.user.id,
          name: concept.trim(),
          description: output,
          pillar: 'explainer' as Pillar,
          total_parts: numParts,
        }])
        .select()
        .single();
      if (seriesErr) throw seriesErr;

      // Parse parts and create post entries
      const partRegex = /PART\s*\[?(\d+)\]?[:\s]*\n?TITLE:\s*(.+)/gi;
      let match;
      const posts: Array<{
        user_id: string;
        title: string;
        pillar: Pillar;
        status: string;
        platform: Platform;
        script: string;
        series_id: string;
        series_position: number;
      }> = [];

      while ((match = partRegex.exec(output)) !== null) {
        const partNum = parseInt(match[1], 10);
        const title = match[2].trim();
        const partStart = match.index;
        const nextPartIdx = output.indexOf('PART', partStart + 5);
        const partText =
          nextPartIdx > 0
            ? output.slice(partStart, nextPartIdx).trim()
            : output.slice(partStart).trim();

        posts.push({
          user_id: userData.user.id,
          title: `${concept.trim()} - ${title}`,
          pillar: 'explainer',
          status: 'idea',
          platform: 'linkedin',
          script: partText,
          series_id: series.id,
          series_position: partNum,
        });
      }

      if (posts.length > 0) {
        const { error: postsErr } = await insforge.database
          .from('posts')
          .insert(posts);
        if (postsErr) throw postsErr;
      }

      setSaved(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save series');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-title text-ink">Plan a series</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink2">
          Describe the arc and how many parts. We&apos;ll outline each episode; you produce and
          publish them from the Series page.
        </p>
      </div>

      <div>
        <label className="field-label">Series concept</label>
        <input
          value={concept}
          onChange={(e) => setConcept(e.target.value)}
          placeholder="What is this series about?"
          className="w-full min-h-[48px] rounded-control border border-hair bg-white px-4 py-3 font-body text-[15px] text-ink placeholder:text-ink3 focus:border-blue focus:outline-none transition-colors"
        />
      </div>

      <div>
        <label className="field-label">Number of parts</label>
        <input
          type="number"
          min={2}
          max={10}
          value={numParts}
          onChange={(e) =>
            setNumParts(
              Math.min(10, Math.max(2, parseInt(e.target.value, 10) || 2)),
            )
          }
          className="w-28 min-h-[48px] rounded-control border border-hair bg-white px-4 py-3 font-body text-[15px] text-ink focus:border-blue focus:outline-none transition-colors"
        />
      </div>

      <Button
        onClick={generate}
        loading={loading}
        disabled={!concept.trim()}
      >
        Plan series
      </Button>

      {error && <p className="font-body text-sm text-flame">{error}</p>}

      <GenerateOutput text={output} loading={loading}>
        <Button
          variant="secondary"
          size="sm"
          onClick={saveSeries}
          loading={saving}
          disabled={saved}
        >
          {saved ? 'Series Saved' : 'Save as Series'}
        </Button>
      </GenerateOutput>
    </div>
  );
}
