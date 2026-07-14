import type { PostAuthPath } from '@/lib/auth-routing';
import { getPostAuthPath } from '@/lib/auth-routing';
import type { TrialSubscriptionRow } from '@/lib/trial';
import { CTA_CHOOSE_PLAN, CTA_FINISH_SETUP, CTA_OPEN_APP, CTA_START_TRIAL } from '@/lib/brand';
import { APP_HOME_PATH } from '@/lib/nav-config';

export interface FunnelState {
  loggedIn: boolean;
  onboardingComplete: boolean;
  sub: TrialSubscriptionRow | null;
}

export interface FunnelCta {
  href: string;
  label: string;
}

/**
 * Resolves the primary marketing CTA from subscription + onboarding state.
 */
export function getFunnelCta(state: FunnelState): FunnelCta {
  if (!state.loggedIn) {
    return { href: '/login', label: CTA_START_TRIAL };
  }

  const path = getPostAuthPath(
    { onboarding_complete: state.onboardingComplete },
    state.sub ?? { status: 'free', trial_ends_at: null, stripe_subscription_id: null }
  );

  return { href: pathToHref(path), label: pathToLabel(path, state.onboardingComplete) };
}

function pathToHref(path: PostAuthPath): string {
  if (path === '/pricing') return '/pricing?trial=expired';
  return path;
}

function pathToLabel(path: PostAuthPath, onboardingComplete: boolean): string {
  if (path === '/pricing') return CTA_CHOOSE_PLAN;
  if (path === APP_HOME_PATH || onboardingComplete) return CTA_OPEN_APP;
  if (path === '/onboarding') return CTA_FINISH_SETUP;
  return CTA_START_TRIAL;
}
