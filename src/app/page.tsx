import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getOrCreateSubscription } from '@/lib/entitlements';
import LandingPageContent from '@/components/landing/LandingPageContent';
import type { FunnelState } from '@/lib/funnel-cta';

export default async function LandingPage() {
  const user = await getAuthenticatedUser();
  const loggedIn = Boolean(user);

  let onboardingComplete = false;
  let sub: FunnelState['sub'] = null;

  if (user) {
    const client = getServerClient();
    const [profileRes, subscription] = await Promise.all([
      client.database
        .from('creator_profile')
        .select('onboarding_complete')
        .eq('user_id', user.id)
        .maybeSingle(),
      getOrCreateSubscription(user.id),
    ]);
    onboardingComplete = Boolean(profileRes.data?.onboarding_complete);
    sub = subscription;
  }

  const funnel: FunnelState = { loggedIn, onboardingComplete, sub };

  return <LandingPageContent funnel={funnel} />;
}
