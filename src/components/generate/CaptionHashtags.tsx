'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { GenerateOutput } from './GenerateOutput';
import { getInsforgeClient } from '@/lib/insforge/client';
import type { HashtagSet } from '@/types/database';
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

export function CaptionHashtags() {
  const [script, setScript] = useState('');
  const [useSaved, setUseSaved] = useState(false);
  const [savedSets, setSavedSets] = useState<HashtagSet[]>([]);
  const [selectedSet, setSelectedSet] = useState('');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saveSetName, setSaveSetName] = useState('');
  const [savingSet, setSavingSet] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const insforge = getInsforgeClient();
        const { data: userData } = await insforge.auth.getCurrentUser();
        if (!userData?.user) return;
        const { data } = await insforge.database
          .from('hashtag_sets')
          .select('*')
          .eq('user_id', userData.user.id)
          .order('created_at', { ascending: false });
        if (data) setSavedSets(data);
      } catch {
        // ignore
      }
    })();
  }, []);

  const generate = async () => {
    if (!script.trim()) {
      setError('Enter a script or video idea');
      return;
    }
    setLoading(true);
    setError('');
    setOutput('');

    let prompt: string;
    if (useSaved && selectedSet) {
      const set = savedSets.find((s) => s.id === selectedSet);
      prompt = `Write an Instagram caption for this video.
VIDEO: ${script.trim()}
CAPTION: 2-4 sentences. First line is the hook shown before "more". Raw, honest, the creator's voice. No em dashes. Direct question at the end to drive comments.

Use these hashtags: ${set?.tags || ''}

Return caption, then blank line, then hashtags.`;
    } else {
      prompt = `Write an Instagram caption and hashtag set.
VIDEO: ${script.trim()}
CAPTION: 2-4 sentences. First line is the hook shown before "more". Raw, honest, the creator's voice. No em dashes. Direct question at the end to drive comments.
HASHTAGS: 20-25 hashtags. Mix niche topics relevant to the creator's content pillars, personal brand, and broad reach. One line, space-separated.
No labels. Just caption, blank line, hashtags.`;
    }

    try {
      const text = await callGenerate(prompt);
      setOutput(text);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  const saveHashtagSet = async () => {
    if (!saveSetName.trim() || !output.trim()) return;
    setSavingSet(true);
    try {
      const insforge = getInsforgeClient();
      const { data: userData } = await insforge.auth.getCurrentUser();
      if (!userData?.user) throw new Error('Not logged in');

      // Extract hashtags from the output (last paragraph)
      const parts = output.split(/\n\s*\n/);
      const hashtags = parts.length > 1 ? parts[parts.length - 1] : output;

      const { error: dbError } = await insforge.database
        .from('hashtag_sets')
        .insert([{
          user_id: userData.user.id,
          name: saveSetName.trim(),
          tags: hashtags.trim(),
          use_count: 0,
        }])
        .select()
        .single();
      if (dbError) throw dbError;
      setSaveSetName('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save set');
    } finally {
      setSavingSet(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="block section-label mb-2">
          Script or video idea
        </label>
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          rows={5}
          placeholder="Paste your script or describe the video idea..."
          className="w-full bg-bg-tertiary border border-border rounded-md px-4 py-3 font-body text-[13px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover resize-none transition-colors duration-100"
        />
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 font-body text-[13px] text-text-primary cursor-pointer">
          <input
            type="checkbox"
            checked={useSaved}
            onChange={(e) => setUseSaved(e.target.checked)}
            className="accent-accent-primary"
          />
          Use saved hashtag set
        </label>
        {useSaved && savedSets.length > 0 && (
          <select
            value={selectedSet}
            onChange={(e) => setSelectedSet(e.target.value)}
            className="bg-bg-tertiary border border-border rounded-md px-3 py-2 font-body text-[13px] text-text-primary focus:outline-none focus:border-border-hover transition-colors duration-100"
          >
            <option value="">Select a set</option>
            {savedSets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <Button onClick={generate} loading={loading} disabled={!script.trim()}>
        Generate
      </Button>

      {error && <p className="font-body text-[13px] text-accent-primary">{error}</p>}

      <GenerateOutput text={output} loading={loading} />

      {output && (
        <div className="flex gap-2 items-center">
          <input
            value={saveSetName}
            onChange={(e) => setSaveSetName(e.target.value)}
            placeholder="Set name"
            className="bg-bg-tertiary border border-border rounded-md px-3 py-2 font-body text-[13px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover transition-colors duration-100"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={saveHashtagSet}
            loading={savingSet}
            disabled={!saveSetName.trim()}
          >
            Save as Hashtag Set
          </Button>
        </div>
      )}
    </div>
  );
}
