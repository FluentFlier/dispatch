'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { GenerateOutput, type GenerateVoiceMetrics } from './GenerateOutput';
import { usePillars } from '@/hooks/usePillars';
import { PLATFORMS } from '@/lib/constants';
import type { Platform } from '@/lib/constants';
import { fetchWithAuth } from '@/lib/fetch-with-auth';

const PILLAR_PROMPTS: Record<string, string> = {
  'hot-take': `Generate a hot take Reel script.
TOPIC (optional): [topic or "choose a strong angle based on the creator's real experience"]
HOOK: One bold controversial sentence. Stop-scrolling.
ARGUMENT: The actual claim, one sentence.
EVIDENCE: Specific proof or real example from the creator's background, one sentence.
FLIP: What they should do or think instead, one sentence.
CTA: One direct question.
Under 60 seconds when spoken. No em dashes. The creator's voice only.`,

  hackathon: `Generate a hackathon story Reel script. Draw from the creator's hackathon experience. Pick a specific, realistic, dramatic story.
HOOK: Drop into the most intense moment. No setup.
SETUP: 2 bullets -- challenge, stakes.
TURN: 1 bullet -- what changed under pressure.
LESSON: 1 bullet -- what this teaches about building.
CTA: Ask viewers about their own experience.
No em dashes.`,

  founder: `Generate a founder-in-public script about building the creator's product or startup.
HOOK: One honest vulnerable sentence. Real energy, no spin.
REALITY: 2 bullets -- what was hard or went wrong.
PROGRESS: 1 bullet -- one thing that moved.
LESSON: 1 bullet -- what this is teaching about startups.
CTA: Invite builders to share their week.
Sound like Tuesday at 11pm, not a success story. No em dashes.`,

  explainer: `Generate a concept explainer based on the creator's expertise. Under 60 seconds.
TOPIC (optional): [topic or "choose one concept from the creator's domain"]
HOOK: A question that makes them feel dumb for not knowing.
SIMPLE VERSION: 2 bullets, zero jargon. 16-year-old readable.
WHY IT MATTERS: 1 bullet.
MISCONCEPTION: 1 bullet.
CTA: Ask what to explain next.
No em dashes.`,

  origin: `Generate an origin/arc video script based on the creator's background and journey.
HOOK: One specific detail that makes someone lean in.
THE PATH: 2 bullets -- the unexpected parts.
THROUGH LINE: 1 bullet -- what actually connects it all.
NOW: 1 bullet -- where it's heading.
CTA: Invite non-linear paths in comments.
No em dashes.`,

  research: `Generate a research unlocked video script that makes the creator's research feel accessible and interesting.
HOOK: One line that makes someone who hates science want to keep watching.
THE WEIRD PART: 2 bullets -- what is genuinely surprising about the research.
WHY IT MATTERS: 1 bullet -- real-world stakes.
THE META LESSON: 1 bullet -- what doing research teaches you that classes do not.
CTA: Ask if they knew this kind of research existed.
No em dashes.`,
};

async function callGenerate(
  prompt: string,
  platform: Platform,
): Promise<{ text: string; voiceMetrics: GenerateVoiceMetrics }> {
  const res = await fetchWithAuth('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, platform, topic: prompt.slice(0, 200) }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Generation failed');
  }
  const data = await res.json();
  return {
    text: data.text,
    voiceMetrics: {
      voice_match_score: data.voice_match_score,
      ai_score: data.ai_score,
      iterations: data.iterations,
      revised: data.revised,
      evaluation: data.evaluation,
    },
  };
}

interface ScriptGeneratorProps {
  initialResult?: string;
  initialTopic?: string;
  initialPillar?: string;
  initialPlatform?: Platform;
}

export function ScriptGenerator({
  initialResult = '',
  initialTopic = '',
  initialPillar = '',
  initialPlatform,
}: ScriptGeneratorProps) {
  const { pillars: pillarList, loading: pillarsLoading, getLabel, getColor } = usePillars();

  const [pillar, setPillar] = useState<string>(initialPillar);
  const [topic, setTopic] = useState(initialTopic);
  const [platform, setPlatform] = useState<Platform>(initialPlatform ?? 'instagram');

  // Sync pillar state when custom pillars finish loading asynchronously
  useEffect(() => {
    if (pillarsLoading || pillarList.length === 0) return;
    // If pillar is still empty (no initial value), default to first loaded pillar
    if (!pillar) {
      setPillar(pillarList[0].value);
      return;
    }
    // If pillar was set from initial props but doesn't exist in loaded list, reset
    if (!pillarList.some((p) => p.value === pillar)) {
      setPillar(pillarList[0].value);
    }
  }, [pillarsLoading, pillarList, pillar]);
  const [output, setOutput] = useState(initialResult);
  const [voiceMetrics, setVoiceMetrics] = useState<GenerateVoiceMetrics | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    setLoading(true);
    setError('');
    setOutput('');
    setVoiceMetrics(undefined);
    try {
      const info = pillarList.find((p) => p.value === pillar);
      let prompt: string;
      if (info?.promptTemplate) {
        prompt = info.promptTemplate;
      } else if (PILLAR_PROMPTS[pillar]) {
        prompt = PILLAR_PROMPTS[pillar];
      } else {
        prompt = `Write a script for a "${getLabel(pillar)}" post. The creator's voice only. Under 60 seconds when spoken. No em dashes.
HOOK: One bold first line.
BODY: 3-4 beats, each one sentence.
CTA: One direct question.`;
      }
      if (topic.trim()) {
        prompt += `\n\nTopic: ${topic.trim()}`;
      }
      const result = await callGenerate(prompt, platform);
      setOutput(result.text);
      setVoiceMetrics(result.voiceMetrics);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="block section-label mb-2">Content Pillar</label>
        <div className="flex flex-wrap gap-2">
          {pillarList.map((p) => (
            <button
              key={p.value}
              onClick={() => setPillar(p.value)}
              className="px-4 py-1.5 rounded-[20px] font-body text-[13px] font-medium transition-all duration-100"
              style={{
                backgroundColor: '#F3EDE4',
                color: pillar === p.value ? p.color : '#78716C',
                border: pillar === p.value
                  ? `1.5px solid ${p.color}`
                  : '1px solid rgba(28, 25, 23, 0.1)',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block section-label mb-2">
          Topic (optional)
        </label>
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          rows={3}
          placeholder="Enter a specific topic or leave blank for a general script..."
          className="w-full bg-bg-tertiary border border-border rounded-md px-4 py-3 font-body text-[13px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover resize-none transition-colors duration-100"
        />
      </div>

      <div>
        <label className="block section-label mb-2">
          Target Platform
        </label>
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className="px-4 py-1.5 rounded-[20px] font-body text-[13px] font-medium transition-all duration-100"
              style={{
                backgroundColor: '#F3EDE4',
                color: platform === p ? '#1C1917' : '#78716C',
                border: platform === p
                  ? '1.5px solid rgba(28, 25, 23, 0.28)'
                  : '1px solid rgba(28, 25, 23, 0.1)',
              }}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <Button onClick={generate} loading={loading}>
        Generate Script
      </Button>

      {error && <p className="font-body text-[13px] text-accent-primary">{error}</p>}

      <GenerateOutput
        text={output}
        loading={loading}
        sourcePlatform={platform}
        voiceMetrics={voiceMetrics}
      />
    </div>
  );
}
