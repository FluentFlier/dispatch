'use client';

import { useCreatorPreferences } from '@/hooks/useCreatorPreferences';
import { Toggle } from '@/components/ui/Toggle';

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
      <Toggle checked={voiceEnabled} onChange={saveVoiceEnabled} disabled={loading} label="Use my voice by default" />
    </div>
  );
}
