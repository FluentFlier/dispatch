import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getUserEntitlements, getOrCreateSubscription } from '@/lib/entitlements';
import { isAppTrialActive, isAppTrialExpired, trialDaysRemaining } from '@/lib/trial';

/** GET: Current session + entitlements (for client bootstrapping) */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ authenticated: false });
  }

  const entitlements = await getUserEntitlements(user.id);
  const sub = await getOrCreateSubscription(user.id);
  const trialActive = isAppTrialActive(sub);
  const client = getServerClient();
  const [{ data: profile }, { data: prefRow }] = await Promise.all([
    client.database
      .from('creator_profile')
      .select('display_name, content_pillars, onboarding_complete, bio_facts')
      .eq('user_id', user.id)
      .maybeSingle(),
    client.database
      .from('user_settings')
      .select('value')
      .eq('user_id', user.id)
      .eq('key', 'preferred_post_length')
      .maybeSingle(),
  ]);

  return NextResponse.json({
    authenticated: true,
    user: { id: user.id, email: user.email },
    profile: profile
      ? {
          displayName: profile.display_name,
          contentPillars: profile.content_pillars,
          onboardingComplete: Boolean(profile.onboarding_complete),
          // First line of bio as a LinkedIn-style headline for post previews.
          headline: (profile.bio_facts as string | null)?.split('\n')[0]?.slice(0, 120) ?? null,
        }
      : null,
    entitlements,
    preferredPostLength: (prefRow?.value ?? 'standard') as 'short' | 'standard' | 'long',
    trial: {
      active: trialActive,
      expired: isAppTrialExpired(sub),
      daysLeft: trialDaysRemaining(sub),
      endsAt: sub.trial_ends_at ?? null,
    },
  });
}
