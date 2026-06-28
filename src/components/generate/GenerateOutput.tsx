'use client';

import { useEffect, useState } from 'react';
import { CopyButton } from '@/components/ui/CopyButton';
import { SkeletonLines } from '@/components/ui/Skeleton';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { PLATFORMS } from '@/lib/constants';
import type { Platform } from '@/lib/constants';
import type { VoiceEvaluationMatrix } from '@/lib/voice-evaluator';
import { usePillars } from '@/hooks/usePillars';
import { OptimizePanel } from './OptimizePanel';
import { fetchWithAuth } from '@/lib/fetch-with-auth';

interface PredictResult {
  tier: 'strong' | 'average' | 'weak';
  score: number;
  hook_score: number;
  signals: string[];
  suggestion: string;
  breakdown: { deterministic: number; ai: number };
}

const TIER_COLOR: Record<PredictResult['tier'], string> = {
  strong: 'text-teal',
  average: 'text-ink2',
  weak: 'text-flame',
};

const TIER_BG: Record<PredictResult['tier'], string> = {
  strong: 'bg-[rgba(var(--color-teal-rgb,110,231,183),0.12)]',
  average: 'bg-[rgba(var(--color-ink2-rgb,252,211,77),0.12)]',
  weak: 'bg-[rgba(var(--color-flame-rgb,252,165,165),0.12)]',
};

function PredictPanel({ result }: { result: PredictResult }) {
  return (
    <div className="bg-bg-secondary border border-border rounded-[10px] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-body text-[11px] uppercase tracking-wide text-text-secondary">
          Performance Prediction
        </p>
        <span
          className={`font-body text-[11px] font-medium px-2 py-0.5 rounded-full border ${TIER_COLOR[result.tier]} border-current/20`}
        >
          {result.tier.charAt(0).toUpperCase() + result.tier.slice(1)} - {result.score}/100
        </span>
      </div>
      <div className="space-y-1">
        {result.signals.map((signal, i) => (
          <p key={i} className="font-body text-[12px] text-text-secondary leading-snug">
            - {signal}
          </p>
        ))}
      </div>
      {result.suggestion && (
        <div className="pt-1 border-t border-border">
          <p className="font-body text-[11px] text-text-tertiary">
            Suggestion: {result.suggestion}
          </p>
        </div>
      )}
      <p className="font-body text-[10px] text-text-tertiary">
        Deterministic: {result.breakdown.deterministic}/100 - AI: {result.breakdown.ai}/100
      </p>
    </div>
  );
}

export interface GenerateVoiceMetrics {
  voice_match_score?: number;
  ai_score?: number;
  iterations?: number;
  revised?: boolean;
  evaluation?: VoiceEvaluationMatrix;
}

interface GenerateOutputProps {
  text: string;
  loading: boolean;
  sourcePlatform?: Platform;
  voiceMetrics?: GenerateVoiceMetrics;
  children?: React.ReactNode;
  onTextUpdate?: (newText: string) => void;
}

function scoreColor(value: number, invert = false): string {
  const good = invert ? value <= 30 : value >= 80;
  const mid = invert ? value <= 60 : value >= 60;
  if (good) return 'text-teal';
  if (mid) return 'text-ink2';
  return 'text-flame';
}

function VoiceMetricsPanel({ metrics }: { metrics: GenerateVoiceMetrics }) {
  const { voice_match_score, ai_score, iterations, revised, evaluation } = metrics;
  const hasHeader =
    voice_match_score !== undefined ||
    ai_score !== undefined ||
    iterations !== undefined;

  if (!hasHeader && !evaluation) return null;

  const dimensions: { key: keyof VoiceEvaluationMatrix; label: string; invert?: boolean }[] = [
    { key: 'persona_fidelity', label: 'Persona' },
    { key: 'uniqueness', label: 'Unique' },
    { key: 'specificity', label: 'Specific' },
    { key: 'so_what', label: 'So what' },
    { key: 'pain_resonance', label: 'Pain' },
    { key: 'ai_slop', label: 'AI slop', invert: true },
  ];

  return (
    <div className="bg-paper2 border border-hair rounded-[10px] p-3 space-y-2">
      <p className="section-label">
        Voice QA
      </p>
      {hasHeader && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px]">
          {voice_match_score !== undefined && (
            <span className={scoreColor(voice_match_score)}>
              Voice match: {voice_match_score}%
            </span>
          )}
          {ai_score !== undefined && (
            <span className={scoreColor(ai_score, true)}>
              AI tells: {ai_score}/100
            </span>
          )}
          {iterations !== undefined && (
            <span className="text-ink3">
              Passes: {iterations}
              {revised ? ' (revised)' : ''}
            </span>
          )}
          {evaluation?.pass !== undefined && (
            <span className={evaluation.pass ? 'text-teal' : 'text-ink2'}>
              {evaluation.pass ? 'Passed' : 'Below threshold'}
            </span>
          )}
        </div>
      )}
      {evaluation && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {dimensions.map(({ key, label, invert }) => {
            const raw = evaluation[key];
            if (typeof raw !== 'number') return null;
            const display = invert ? `${raw}/10` : `${raw}/10`;
            const pct = invert ? (10 - raw) * 10 : raw * 10;
            return (
              <div key={key} className="text-center">
                <p className={`font-mono text-[13px] font-medium ${scoreColor(pct, invert)}`}>
                  {display}
                </p>
                <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink3">{label}</p>
              </div>
            );
          })}
        </div>
      )}
      {evaluation?.revision_notes && !evaluation.pass && (
        <p className="font-mono text-[11px] text-ink3 leading-snug">
          {evaluation.revision_notes}
        </p>
      )}
    </div>
  );
}

export function GenerateOutput({
  text,
  loading,
  sourcePlatform,
  voiceMetrics,
  children,
  onTextUpdate,
}: GenerateOutputProps) {
  const { toast } = useToast();
  const [showSave, setShowSave] = useState(false);
  const [humanizing, setHumanizing] = useState(false);
  const [aiScore, setAiScore] = useState<number | null>(null);
  const [scoring, setScoring] = useState(false);
  const [prediction, setPrediction] = useState<PredictResult | null>(null);
  const [predicting, setPredicting] = useState(false);

  async function handleHumanize() {
    setHumanizing(true);
    try {
      const res = await fetchWithAuth('/api/humanize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as { error?: string }).error ?? 'Humanization failed';
        toast(res.status === 402 ? 'Monthly AI limit reached. Upgrade your plan.' : msg, 'error');
        return;
      }
      const { text: humanized } = await res.json();
      if (onTextUpdate) onTextUpdate(humanized);
    } catch (err) {
      console.error('Humanize error:', err);
      toast('Humanization failed', 'error');
    } finally {
      setHumanizing(false);
    }
  }

  async function handleScore() {
    setScoring(true);
    try {
      const res = await fetchWithAuth('/api/humanize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, scoreOnly: true }),
      });
      if (!res.ok) throw new Error('Scoring failed');
      const { score } = await res.json();
      setAiScore(score);
    } catch {
      setAiScore(null);
    } finally {
      setScoring(false);
    }
  }

  async function handlePredict() {
    setPredicting(true);
    setPrediction(null);
    try {
      const res = await fetchWithAuth('/api/posts/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          platform: sourcePlatform ?? 'linkedin',
          voice_match_score: voiceMetrics?.voice_match_score ?? null,
          ai_score: voiceMetrics?.ai_score ?? null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as { error?: string }).error ?? 'Prediction failed';
        toast(res.status === 402 ? 'Monthly AI limit reached. Upgrade your plan.' : msg, 'error');
        return;
      }
      const data: PredictResult = await res.json();
      setPrediction(data);
    } catch (err) {
      console.error('Predict error:', err);
      toast('Prediction failed', 'error');
    } finally {
      setPredicting(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-bg-tertiary border border-border rounded-lg p-[13px_14px] space-y-3">
        <SkeletonLines count={3} />
      </div>
    );
  }

  if (!text) return null;

  const showVoiceMetrics =
    voiceMetrics &&
    (voiceMetrics.voice_match_score !== undefined ||
      voiceMetrics.iterations !== undefined ||
      voiceMetrics.evaluation !== undefined);

  return (
    <div className="space-y-4">
      {showVoiceMetrics && <VoiceMetricsPanel metrics={voiceMetrics} />}
      {prediction && <PredictPanel result={prediction} />}
      <div className="bg-bg-tertiary border border-border rounded-lg p-[13px_14px] space-y-4">
        <pre className="whitespace-pre-wrap font-body text-[13px] text-text-primary leading-[1.55]">
          {text}
        </pre>
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton text={text} />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowSave(true)}
          >
            Save to Library
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleHumanize}
            loading={humanizing}
          >
            Humanize
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handlePredict}
            loading={predicting}
          >
            {predicting ? 'Predicting...' : 'Predict'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleScore}
            loading={scoring}
          >
            {aiScore !== null ? (
              <span className={`font-mono ${aiScore > 60 ? 'text-flame' : aiScore > 30 ? 'text-ink2' : 'text-teal'}`}>
                AI Score: {aiScore}/100
              </span>
            ) : 'Check AI Score'}
          </Button>
          {children}
        </div>
      </div>

      {/* Platform optimization section */}
      <OptimizePanel content={text} sourcePlatform={sourcePlatform} />

      <SaveToLibraryModal
        open={showSave}
        onClose={() => setShowSave(false)}
        script={text}
        voiceMetrics={voiceMetrics}
        sourcePlatform={sourcePlatform}
      />
    </div>
  );
}

/* Save to Library modal */
function SaveToLibraryModal({
  open,
  onClose,
  script,
  voiceMetrics,
  sourcePlatform,
}: {
  open: boolean;
  onClose: () => void;
  script: string;
  voiceMetrics?: GenerateVoiceMetrics;
  sourcePlatform?: Platform;
}) {
  const { toast } = useToast();
  const { pillars: pillarList, loading: pillarsLoading } = usePillars();
  const [title, setTitle] = useState(() => {
    const firstLine = script.split('\n').find((l) => l.trim())?.trim() ?? '';
    const cleaned = firstLine.replace(/^[#*\->\s]+/, '').slice(0, 120);
    // Don't use AI label lines as title
    const isLabel = /^here.?s the (rewritten|revised|updated|final)/i.test(cleaned);
    return isLabel ? '' : cleaned;
  });
  const [platform, setPlatform] = useState<Platform>(sourcePlatform ?? 'instagram');
  const [pillar, setPillar] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Sync pillar state when custom pillars finish loading
  useEffect(() => {
    if (pillarsLoading || pillarList.length === 0) return;
    if (!pillar) {
      setPillar(pillarList[0].value);
    }
  }, [pillarsLoading, pillarList, pillar]);

  const save = async () => {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetchWithAuth('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          pillar,
          script,
          status: 'scripted',
          platform,
          voice_match_score: voiceMetrics?.voice_match_score ?? null,
          ai_score: voiceMetrics?.ai_score ?? null,
          voice_evaluation: voiceMetrics?.evaluation ?? null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? 'Failed to save');
      }
      toast('Saved to library');
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Save to Library">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Post title"
        className="w-full bg-bg-tertiary border border-border rounded-md px-3 py-2 font-body text-[13px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-hover transition-colors duration-100"
      />
      <div className="flex gap-3">
        <select
          value={pillar}
          onChange={(e) => setPillar(e.target.value)}
          className="flex-1 bg-bg-tertiary border border-border rounded-md px-3 py-2 font-body text-[13px] text-text-primary focus:outline-none focus:border-border-hover transition-colors duration-100"
        >
          {pillarList.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value as Platform)}
          className="flex-1 bg-bg-tertiary border border-border rounded-md px-3 py-2 font-body text-[13px] text-text-primary focus:outline-none focus:border-border-hover transition-colors duration-100"
        >
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="font-body text-[13px] text-accent-primary">{error}</p>}
      <div className="flex gap-3 justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} loading={saving}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
