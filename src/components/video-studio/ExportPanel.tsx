'use client';

import { useState } from 'react';
import { Loader2, Wand2 } from 'lucide-react';
import type { TemplateId } from './TemplateSelector';

type Format = 'mp4' | 'webm';
type Quality = '720p' | '1080p';

interface ExportPanelProps {
  videoSrc?: string;
  templateId?: TemplateId;
}

export default function ExportPanel({ videoSrc, templateId }: ExportPanelProps) {
  const [format, setFormat] = useState<Format>('mp4');
  const [quality, setQuality] = useState<Quality>('1080p');
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canExport = Boolean(videoSrc && templateId);

  const handleApply = async () => {
    if (!canExport) return;
    setWorking(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/video/auto-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: videoSrc,
          options: {
            template: templateId,
            format,
            quality,
            captions: templateId === 'talking-head-captions',
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Auto-edit failed');
      }

      const data = await res.json();
      if (Array.isArray(data.captions) && data.captions.length > 0) {
        setResult(`Generated ${data.captions.length} caption cues. Preview your edit in the player above.`);
      } else {
        setResult('Edit settings saved. Preview your edit in the player above.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auto-edit failed');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="rounded-lg bg-bg-tertiary border border-border p-4 space-y-4">
      <h3 className="font-heading text-[15px] font-semibold text-text-primary">
        Auto-edit
      </h3>

      {/* Format selector */}
      <div className="space-y-1.5">
        <label className="font-body text-[12px] text-text-secondary">Format</label>
        <div className="flex gap-2">
          {(['mp4', 'webm'] as Format[]).map((f) => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              className={`px-4 py-1.5 rounded-md font-body text-[13px] font-medium transition-all duration-100 ${
                format === f
                  ? 'bg-accent-primary text-white'
                  : 'bg-bg-tertiary text-text-tertiary hover:bg-bg-tertiary/80'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Quality selector */}
      <div className="space-y-1.5">
        <label className="font-body text-[12px] text-text-secondary">Quality</label>
        <div className="flex gap-2">
          {(['720p', '1080p'] as Quality[]).map((q) => (
            <button
              key={q}
              onClick={() => setQuality(q)}
              className={`px-4 py-1.5 rounded-md font-body text-[13px] font-medium transition-all duration-100 ${
                quality === q
                  ? 'bg-accent-primary text-white'
                  : 'bg-bg-tertiary text-text-tertiary hover:bg-bg-tertiary/80'
              }`}
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {result && (
        <p className="font-body text-[11px] text-accent-secondary">{result}</p>
      )}
      {error && (
        <p className="font-body text-[11px] text-accent-primary">{error}</p>
      )}

      {/* Apply button */}
      <button
        onClick={handleApply}
        disabled={!canExport || working}
        className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-md font-body text-[13px] font-medium transition-all ${
          canExport && !working
            ? 'bg-accent-primary text-white hover:opacity-90'
            : 'bg-bg-tertiary text-text-secondary cursor-not-allowed'
        }`}
      >
        {working ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Wand2 className="w-4 h-4" />
        )}
        {working ? 'Working...' : canExport ? 'Apply auto-edit' : 'Select a template first'}
      </button>

      <p className="font-body text-[11px] text-text-tertiary leading-snug">
        Auto-edit prepares your caption cues and edit settings for the live preview.
        Rendering a downloadable file is in beta and not available yet.
      </p>
    </div>
  );
}
