'use client';

import { useCreatorPreferences } from '@/hooks/useCreatorPreferences';

/**
 * Global default for whether AI generation imports the creator's voice. Users
 * can still override this per draft in the Compose screen; this sets the
 * starting position. Off is useful when someone wants clean, neutral drafts
 * (e.g. their recent posts aren't representative of how they want to sound).
 */
export default function VoiceDefaultToggle() {
  const { voiceEnabled, loading, saveVoiceEnabled } = useCreatorPreferences();

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-text-primary">Use my voice by default</p>
        <p className="mt-1 text-xs text-text-secondary">
          {voiceEnabled
            ? 'New drafts import your voice, rules, and pillars. You can turn this off per draft.'
            : 'New drafts are clean and neutral by default. Turn it on per draft any time.'}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={voiceEnabled}
        aria-label="Use my voice by default"
        disabled={loading}
        onClick={() => saveVoiceEnabled(!voiceEnabled)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${voiceEnabled ? 'bg-accent-primary' : 'bg-border'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${voiceEnabled ? 'translate-x-5' : 'translate-x-0.5'}`}
        />
      </button>
    </div>
  );
}
