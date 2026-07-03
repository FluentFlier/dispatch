import type { VoiceSample } from '@/lib/onboarding/import-posts';

/**
 * Picks a balanced mix of social posts + emails for voice analysis.
 * Emails reveal conversational register; posts reveal public voice — both matter.
 */
export function selectBalancedVoiceSamples(
  samples: VoiceSample[],
  limit = 20,
): VoiceSample[] {
  const isEmail = (s: VoiceSample) =>
    s.platform.toLowerCase().includes('email');

  const emails = samples
    .filter(isEmail)
    .sort((a, b) => b.content.length - a.content.length);

  const social = samples
    .filter((s) => !isEmail(s))
    .sort((a, b) => b.content.length - a.content.length);

  const emailSlots = emails.length > 0 ? Math.min(6, Math.max(2, Math.floor(limit * 0.3))) : 0;
  const socialSlots = limit - emailSlots;

  const picked = [
    ...social.slice(0, socialSlots),
    ...emails.slice(0, emailSlots),
  ];

  if (picked.length >= limit) return picked.slice(0, limit);

  const remaining = [...social.slice(socialSlots), ...emails.slice(emailSlots)]
    .sort((a, b) => b.content.length - a.content.length);

  return [...picked, ...remaining].slice(0, limit);
}
