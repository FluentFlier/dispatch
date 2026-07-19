/**
 * Step identity and resume logic for the onboarding wizard.
 *
 * Steps are URL-addressed (`/onboarding?step=`) because the connect step leaves
 * the app entirely for Unipile/Composio and must come back to the right place.
 * Resume is a pure function of server state so refresh, OAuth return, and a new
 * tab all share one code path.
 */

export type StepKey = 'you' | 'connect' | 'profile';

export const STEP_ORDER: readonly StepKey[] = ['you', 'connect', 'profile'] as const;

export interface OnboardingResumeStatus {
  connectedCount: number;
  hasBaseline: boolean;
}

export function isStepKey(value: unknown): value is StepKey {
  return typeof value === 'string' && (STEP_ORDER as readonly string[]).includes(value);
}

/**
 * Picks the step to render. An explicit, valid `?step=` always wins so the Back
 * button is never fought by resume. Otherwise the furthest reached step is used.
 */
export function resolveStep(
  status: OnboardingResumeStatus,
  requested: string | null,
): StepKey {
  if (isStepKey(requested)) return requested;
  if (status.hasBaseline) return 'profile';
  if (status.connectedCount > 0) return 'connect';
  return 'you';
}
