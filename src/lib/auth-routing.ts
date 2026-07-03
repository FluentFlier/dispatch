import type { TrialSubscriptionRow } from '@/lib/trial';
import { hasPaidSubscription, isAppTrialActive, mustSubscribe } from '@/lib/trial';

export type PostAuthPath = '/get-started' | '/onboarding' | '/dashboard' | '/pricing';

export interface AuthRoutingProfile {
  onboarding_complete?: boolean | null;
}

/**
 * Chooses where to send a user after sign-in or trial start.
 * Trial-first: no access without trial; profile setup before dashboard.
 */
export function getPostAuthPath(
  profile: AuthRoutingProfile | null,
  sub: TrialSubscriptionRow
): PostAuthPath {
  if (mustSubscribe(sub)) {
    return '/pricing';
  }

  const hasAccess = hasPaidSubscription(sub) || isAppTrialActive(sub);
  if (!hasAccess) {
    return '/get-started';
  }

  if (profile?.onboarding_complete) {
    return '/dashboard';
  }

  return '/onboarding';
}
