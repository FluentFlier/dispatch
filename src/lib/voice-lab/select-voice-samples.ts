import type { VoiceSample } from '@/lib/onboarding/import-posts';

/**
 * Picks a balanced mix of social posts + emails for voice analysis.
 * Emails reveal conversational register; posts reveal public voice - both matter.
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

/**
 * Curates the sample_posts persisted for GENERATION few-shot (distinct from
 * selectBalancedVoiceSamples, which feeds voice ANALYSIS). Few-shot examples
 * are the strongest cloning signal, so don't store an arbitrary import-order
 * slice (audit P1-1): dedupe near-identical posts, prefer substantial ones,
 * longest first as a quality proxy until engagement ranking exists.
 */
export function curateSamplePosts(samples: VoiceSample[], limit = 10): VoiceSample[] {
  const seen = new Set<string>();
  const deduped = samples.filter((s) => {
    const key = s.content.trim().toLowerCase().slice(0, 80);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const substantial = deduped.filter((s) => {
    const len = s.content.trim().length;
    return len >= 100 && len <= 2500;
  });

  // Only apply the substance filter when it leaves enough to work with -
  // a creator of one-liners still deserves their one-liners as examples.
  const pool = substantial.length >= Math.min(limit, 3) ? substantial : deduped;

  return [...pool]
    .sort((a, b) => b.content.length - a.content.length)
    .slice(0, limit);
}
