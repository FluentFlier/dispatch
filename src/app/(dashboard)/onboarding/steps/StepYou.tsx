'use client';

import { COPY } from '../copy';

interface StepYouProps {
  displayName: string;
  onDisplayNameChange: (value: string) => void;
  focus: string;
  onFocusChange: (value: string) => void;
}

/** Step 1 body. The shell owns the footer, so this renders fields only. */
export function StepYou({ displayName, onDisplayNameChange, focus, onFocusChange }: StepYouProps) {
  const copy = COPY.steps.you;

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="onboarding-name" className="section-label mb-2 block">
          {copy.nameLabel}
        </label>
        <input
          id="onboarding-name"
          type="text"
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          placeholder={copy.namePlaceholder}
          className="w-full rounded-md border border-hair bg-paper px-4 py-2.5 text-ink placeholder:text-ink3 focus:border-accent-primary focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="onboarding-focus" className="section-label mb-2 block">
          {copy.focusLabel}
        </label>
        <textarea
          id="onboarding-focus"
          value={focus}
          onChange={(e) => onFocusChange(e.target.value)}
          placeholder={copy.focusPlaceholder}
          rows={3}
          className="w-full resize-none rounded-md border border-hair bg-paper px-4 py-2.5 text-ink placeholder:text-ink3 focus:border-accent-primary focus:outline-none"
        />
        <p className="mt-2 text-xs text-ink3">{copy.focusHint}</p>
      </div>
    </div>
  );
}
