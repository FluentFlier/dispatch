import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import LandingPageContent from '@/components/landing/LandingPageContent';

export default async function LandingPage() {
  const user = await getAuthenticatedUser();
  const loggedIn = Boolean(user);

  let onboardingComplete = false;
  if (user) {
    const client = getServerClient();
    const { data: profile } = await client.database
      .from('creator_profile')
      .select('onboarding_complete')
      .eq('user_id', user.id)
      .maybeSingle();
    onboardingComplete = Boolean(profile?.onboarding_complete);
  }

  return (
    <LandingPageContent loggedIn={loggedIn} onboardingComplete={onboardingComplete} />
  );
}
