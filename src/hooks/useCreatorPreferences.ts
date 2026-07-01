'use client';

import { useEffect, useState } from 'react';

export type PostLength = 'short' | 'standard' | 'long';

export const POST_LENGTH_CONFIG: Record<PostLength, { label: string; words: number; hint: string }> = {
  short:    { label: 'Short',    words: 80,  hint: 'Target length: ~80 words. Hook-style, punchy, brief.' },
  standard: { label: 'Standard', words: 200, hint: 'Target length: ~200 words. Standard post.' },
  long:     { label: 'Long',     words: 400, hint: 'Target length: ~400 words. Full post with developed story, context, and insight.' },
};

interface UseCreatorPreferencesReturn {
  preferredPostLength: PostLength;
  /** Global default for whether generation imports the creator's voice. */
  voiceEnabled: boolean;
  loading: boolean;
  savePreferredPostLength: (length: PostLength) => Promise<void>;
  saveVoiceEnabled: (enabled: boolean) => Promise<void>;
}

/**
 * Reads the user's saved content preferences (post length default from the
 * session endpoint; voice on/off from /api/preferences) and provides save
 * functions that PUT to /api/preferences.
 */
export function useCreatorPreferences(): UseCreatorPreferencesReturn {
  const [preferredPostLength, setPreferredPostLength] = useState<PostLength>('standard');
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Post length comes from the session payload (existing behaviour).
    fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.preferredPostLength) {
          setPreferredPostLength(data.preferredPostLength as PostLength);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Voice on/off comes from the preferences endpoint.
    fetch('/api/preferences', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.voice_enabled === 'boolean') setVoiceEnabled(data.voice_enabled);
      })
      .catch(() => {});
  }, []);

  async function savePreferredPostLength(length: PostLength): Promise<void> {
    setPreferredPostLength(length);
    await fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferred_post_length: length }),
    }).catch(() => {});
  }

  async function saveVoiceEnabled(enabled: boolean): Promise<void> {
    setVoiceEnabled(enabled);
    await fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice_enabled: enabled }),
    }).catch(() => {});
  }

  return { preferredPostLength, voiceEnabled, loading, savePreferredPostLength, saveVoiceEnabled };
}
