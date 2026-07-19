'use client';

import type { ContentPillarConfig } from '@/types/database';
import { COPY } from '../copy';

interface StepProfileProps {
  voiceDescription: string;
  onVoiceDescriptionChange: (value: string) => void;
  voiceRules: string;
  onVoiceRulesChange: (value: string) => void;
  pillars: ContentPillarConfig[];
  onPillarsChange: (pillars: ContentPillarConfig[]) => void;
}

/** Step 3 body: confirm and edit the derived profile before it is saved. */
export function StepProfile({
  voiceDescription,
  onVoiceDescriptionChange,
  voiceRules,
  onVoiceRulesChange,
  pillars,
  onPillarsChange,
}: StepProfileProps) {
  const copy = COPY.steps.profile;

  function renamePillar(index: number, name: string) {
    onPillarsChange(pillars.map((p, i) => (i === index ? { ...p, name } : p)));
  }

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="onboarding-voice" className="section-label mb-2 block">
          {copy.voiceLabel}
        </label>
        <textarea
          id="onboarding-voice"
          value={voiceDescription}
          onChange={(e) => onVoiceDescriptionChange(e.target.value)}
          placeholder={copy.voicePlaceholder}
          rows={4}
          className="w-full resize-none rounded-md border border-hair bg-paper px-4 py-2.5 text-ink placeholder:text-ink3 focus:border-accent-primary focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="onboarding-rules" className="section-label mb-2 block">
          {copy.rulesLabel}
        </label>
        <textarea
          id="onboarding-rules"
          value={voiceRules}
          onChange={(e) => onVoiceRulesChange(e.target.value)}
          placeholder={copy.rulesPlaceholder}
          rows={3}
          className="w-full resize-none rounded-md border border-hair bg-paper px-4 py-2.5 text-ink placeholder:text-ink3 focus:border-accent-primary focus:outline-none"
        />
      </div>

      <div>
        <span className="section-label mb-2 block">{copy.pillarsLabel}</span>
        <div className="space-y-2">
          {pillars.map((pillar, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-md border border-hair bg-paper2 px-3 py-2"
              style={{ borderLeftColor: pillar.color, borderLeftWidth: 3 }}
            >
              <input
                type="text"
                value={pillar.name}
                onChange={(e) => renamePillar(i, e.target.value)}
                placeholder={copy.pillarNamePlaceholder}
                aria-label={`${copy.pillarsLabel} ${i + 1}`}
                className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink3 focus:outline-none"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
