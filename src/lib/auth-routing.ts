import type { TrialSubscriptionRow } from '@/lib/trial';
import { hasPaidSubscription, isAppTrialActive, mustSubscribe } from '@/lib/trial';
import { APP_HOME_PATH } from '@/lib/nav-config';

export type PostAuthPath = '/get-started' | '/onboarding' | typeof APP_HOME_PATH | '/pricing';

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
    return APP_HOME_PATH;
  }

  return '/onboarding';
}
