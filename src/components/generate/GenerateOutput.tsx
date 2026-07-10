'use client';

import { useEffect, useState } from 'react';
import { CopyButton } from '@/components/ui/CopyButton';
import { SkeletonLines } from '@/components/ui/Skeleton';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { PLATFORMS, normalizeDashboardPlatform } from '@/lib/constants';
import type { DashboardPlatform } from '@/lib/constants';
import type { VoiceEvaluationMatrix } from '@/lib/voice-evaluator';
import { usePillars } from '@/hooks/usePillars';
import PillarMultiSelect from '@/components/ui/PillarMultiSelect';
import { DEFAULT_PILLAR_WEIGHT } from '@/lib/pillars';
import { OptimizePanel } from './OptimizePanel';
import { LinkedInComposer } from './LinkedInComposer';
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

/** Friendly platform names for the direct publish action. */
const PLATFORM_LABELS: Record<string, string> = {
  twitter: 'X',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  threads: 'Threads',
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
  used_hook_ids?: string[];
  hook_explanations?: Array<{ id: string; text: string; author: string; rlScore: number; source: string; reason: string }>;
  pipeline_stages?: string[];
  humanize_passes?: string[];
}

interface GenerateOutputProps {
  text: string;
  loading: boolean;
  sourcePlatform?: DashboardPlatform;
  voiceMetrics?: GenerateVoiceMetrics;
  children?: React.ReactNode;
  onTextUpdate?: (newText: string) => void;
  /** Simple = creator flow: edit, viral score, post/save/copy only */
  variant?: 'full' | 'simple';
  /** Default pillar slug for one-click save in simple mode */
  savePillar?: string;
}

function scoreColor(value: number, invert = false): string {
  const good = invert ? value <= 30 : value >= 80;
  const mid = invert ? value <= 60 : value >= 60;
  if (good) return 'text-teal';
  if (mid) return 'text-ink2';
  return 'text-flame';
}

function VoiceMetricsPanel({ metrics }: { metrics: GenerateVoiceMetrics }) {
  const {
    voice_match_score,
    ai_score,
    iterations,
    revised,
    evaluation,
    pipeline_stages,
    humanize_passes,
    hook_explanations,
  } = metrics;
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
      {pipeline_stages && pipeline_stages.length > 0 && (
        <p className="font-mono text-[10px] text-ink3">
          Pipeline: {pipeline_stages.join(' → ')}
          {humanize_passes?.length ? ` · humanize: ${humanize_passes.join(', ')}` : ''}
        </p>
      )}
      {hook_explanations && hook_explanations.length > 0 && (
        <div className="space-y-1 border-t border-hair pt-2">
          <p className="font-mono text-[10px] uppercase tracking-wide text-ink3">Hooks used (learned)</p>
          {hook_explanations.slice(0, 3).map((h) => (
            <p key={h.id} className="font-body text-[11px] text-ink2 leading-snug">
              &ldquo;{h.text}&hellip;&rdquo; — {h.reason}
            </p>
          ))}
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
  variant = 'full',
  savePillar,
}: GenerateOutputProps) {
  const { toast } = useToast();
  const [showSave, setShowSave] = useState(false);
  const [humanizing, setHumanizing] = useState(false);
  const [aiScore, setAiScore] = useState<number | null>(null);
  const [scoring, setScoring] = useState(false);
  const [prediction, setPrediction] = useState<PredictResult | null>(null);
  const [predicting, setPredicting] = useState(false);
  const [published, setPublished] = useState<{ platform: string; url?: string } | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [quickSaving, setQuickSaving] = useState(false);
  const [autoPredicted, setAutoPredicted] = useState(false);

  // Local copy of the draft so in-place edits (Humanize) are reflected on every
  // tab, even those that don't pass onTextUpdate. Re-syncs whenever a new
  // generation arrives via the `text` prop.
  const [displayText, setDisplayText] = useState(text);
  useEffect(() => {
    setDisplayText(text);
    setPublished(null);
    setAutoPredicted(false);
    setPrediction(null);
  }, [text]);

  async function handleHumanize() {
    setHumanizing(true);
    try {
      const res = await fetchWithAuth('/api/humanize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: displayText }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as { error?: string }).error ?? 'Humanization failed';
        toast(res.status === 402 ? 'Monthly AI limit reached. Upgrade your plan.' : msg, 'error');
        return;
      }
      const { text: humanized } = await res.json();
      setDisplayText(humanized);
      onTextUpdate?.(humanized);
      toast('Humanized');
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
        body: JSON.stringify({ text: displayText, scoreOnly: true }),
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
    const bodyText = displayText.trim() ? displayText : text;
    setPredicting(true);
    setPrediction(null);
    try {
      const res = await fetchWithAuth('/api/posts/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: bodyText,
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

  async function quickSave() {
    const firstLine = displayText.split('\n').find((l) => l.trim())?.trim() ?? 'Untitled draft';
    const title = firstLine.replace(/^[#*\->\s]+/, '').slice(0, 120);
    setQuickSaving(true);
    try {
      const res = await fetchWithAuth('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title || 'Untitled draft',
          pillars: savePillar ? [savePillar] : ['general'],
          script: displayText,
          status: 'scripted',
          platform: sourcePlatform ?? 'linkedin',
          voice_match_score: voiceMetrics?.voice_match_score ?? null,
          ai_score: voiceMetrics?.ai_score ?? null,
          // Persist the evaluation too so quick-saved drafts feed the voice
          // flywheel (workspace_voice_metrics) the same as full saves + cron.
          voice_evaluation: voiceMetrics?.evaluation ?? null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? 'Failed to save');
      }
      toast('Saved to Posts');
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to save', 'error');
    } finally {
      setQuickSaving(false);
    }
  }

  // Simple mode: auto-score once a new draft lands.
  useEffect(() => {
    if (variant !== 'simple' || !text.trim() || loading || autoPredicted) return;
    setAutoPredicted(true);
    void handlePredict();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, text, loading, autoPredicted]);

  if (loading) {
    return (
      <div className="bg-bg-tertiary border border-border rounded-lg p-[13px_14px] space-y-3">
        <SkeletonLines count={3} />
      </div>
    );
  }

  if (!text) return null;

  const showVoiceMetrics =
    variant === 'full' &&
    voiceMetrics &&
    (voiceMetrics.voice_match_score !== undefined ||
      voiceMetrics.iterations !== undefined ||
      voiceMetrics.evaluation !== undefined);

  const viralLabel = prediction
    ? prediction.tier === 'strong'
      ? 'Strong hook'
      : prediction.tier === 'average'
        ? 'Decent draft'
        : 'Sharpen the hook'
    : null;

  return (
    <div className="space-y-4">
      {published && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-teal/30 bg-teal/5 px-4 py-3">
          <span className="text-sm font-medium text-teal">
            Posted to {PLATFORM_LABELS[published.platform] ?? published.platform}
          </span>
          {published.url && (
            <a
              href={published.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-accent-primary hover:underline"
            >
              View post
            </a>
          )}
        </div>
      )}
      {showVoiceMetrics && <VoiceMetricsPanel metrics={voiceMetrics} />}
      {variant === 'full' && prediction && <PredictPanel result={prediction} />}
      <div className="rounded-2xl border border-hair bg-paper p-4 space-y-3">
        {variant === 'simple' && (
          <div className="flex items-center justify-between gap-2 text-[12px]">
            {predicting ? (
              <span className="text-ink3">Checking hook strength…</span>
            ) : prediction ? (
              <span className={`font-medium ${TIER_COLOR[prediction.tier]}`}>
                {viralLabel} · {prediction.score}/100
              </span>
            ) : (
              <span className="text-ink3">Formatted for {PLATFORM_LABELS[sourcePlatform ?? 'linkedin']}</span>
            )}
            {prediction?.suggestion && prediction.tier !== 'strong' && (
              <span className="text-ink3 truncate max-w-[55%]" title={prediction.suggestion}>
                {prediction.suggestion}
              </span>
            )}
          </div>
        )}
        <textarea
          value={displayText}
          onChange={(e) => { setDisplayText(e.target.value); onTextUpdate?.(e.target.value); }}
          rows={Math.min(18, Math.max(6, displayText.split('\n').length + 1))}
          aria-label="Generated draft (editable)"
          className="w-full resize-y bg-transparent font-body text-[15px] text-ink leading-relaxed focus:outline-none"
        />
        {variant === 'simple' ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button variant="primary" size="sm" onClick={() => setComposerOpen(true)}>
              Post
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void quickSave()} loading={quickSaving}>
              Save
            </Button>
            <CopyButton text={displayText} />
            <Button variant="ghost" size="sm" onClick={handleHumanize} loading={humanizing}>
              Polish
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={displayText} />
            <Button variant="primary" size="sm" onClick={() => setComposerOpen(true)}>
              Preview &amp; post to {PLATFORM_LABELS[sourcePlatform ?? 'linkedin'] ?? 'platform'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setShowSave(true)}>
              Save to Library
            </Button>
            <Button variant="secondary" size="sm" onClick={handleHumanize} loading={humanizing}>
              Humanize
            </Button>
            <Button variant="secondary" size="sm" onClick={handlePredict} loading={predicting}>
              {predicting ? 'Predicting...' : 'Predict'}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleScore} loading={scoring}>
              {aiScore !== null ? (
                <span className={`font-mono ${aiScore > 60 ? 'text-flame' : aiScore > 30 ? 'text-ink2' : 'text-teal'}`}>
                  AI Score: {aiScore}/100
                </span>
              ) : 'Check AI Score'}
            </Button>
            {children}
          </div>
        )}
      </div>

      {variant === 'full' && <OptimizePanel content={displayText} sourcePlatform={sourcePlatform} />}

      {variant === 'full' && (
        <SaveToLibraryModal
          open={showSave}
          onClose={() => setShowSave(false)}
          script={displayText}
          voiceMetrics={voiceMetrics}
          sourcePlatform={sourcePlatform}
        />
      )}

      <LinkedInComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        initialText={displayText}
        platform={sourcePlatform ?? 'linkedin'}
        onPublished={(url) => setPublished({ platform: sourcePlatform ?? 'linkedin', url })}
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
  sourcePlatform?: DashboardPlatform;
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
  const [platform, setPlatform] = useState<DashboardPlatform>(
    normalizeDashboardPlatform(sourcePlatform ?? 'linkedin'),
  );
  const [pillars, setPillars] = useState<string[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Default to the first pillar (at the neutral weight) once pillars finish loading.
  useEffect(() => {
    if (pillarsLoading || pillarList.length === 0) return;
    if (pillars.length === 0) {
      const first = pillarList[0].value;
      setPillars([first]);
      setWeights({ [first]: DEFAULT_PILLAR_WEIGHT });
    }
  }, [pillarsLoading, pillarList, pillars.length]);

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
          pillars,
          pillar_weights: weights,
          script,
          status: 'scripted',
          platform,
          voice_match_score: voiceMetrics?.voice_match_score ?? null,
          ai_score: voiceMetrics?.ai_score ?? null,
          voice_evaluation: voiceMetrics?.evaluation ?? null,
          used_hook_ids: voiceMetrics?.used_hook_ids ?? [],
          // NOTE: hook_explanations is display-only transient data, not a posts
          // column. The /api/posts schema is .strict(), so including it 400'd the
          // entire save and the voice scores never persisted (break 6). The cron
          // path never saved it either. Kept out of the persisted body on purpose.
          pipeline_stages: voiceMetrics?.pipeline_stages ?? [],
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
      <div>
        <span className="block text-[11px] text-text-secondary mb-1.5 font-medium tracking-wide">
          Pillars (pick one or more)
        </span>
        <PillarMultiSelect
          pillars={pillars}
          weights={weights}
          onChange={(next) => {
            setPillars(next.pillars);
            setWeights(next.weights);
          }}
        />
      </div>
      <select
        value={platform}
        onChange={(e) => setPlatform(e.target.value as DashboardPlatform)}
        className="w-full bg-bg-tertiary border border-border rounded-md px-3 py-2 font-body text-[13px] text-text-primary focus:outline-none focus:border-border-hover transition-colors duration-100"
      >
        {PLATFORMS.map((p) => (
          <option key={p} value={p}>
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </option>
        ))}
      </select>
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
