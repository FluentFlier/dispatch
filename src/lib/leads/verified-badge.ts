import type { SignalLeadContactRow } from '@/lib/signals/types';

/**
 * Verification state of a contact's LinkedIn, used to pick the badge shown next
 * to the founder's LinkedIn link in LeadDetail:
 *   - 'verified'   → the URL was confirmed via the workspace Unipile account
 *   - 'unverified' → there is a URL but it has not been confirmed (may be stale)
 *   - null         → no LinkedIn URL, so no badge (nothing to verify)
 *
 * Kept pure (no JSX / no DB) so the decision is unit-testable even though the
 * repo's vitest setup cannot render the .tsx component directly.
 */
export type LinkedInBadgeState = 'verified' | 'unverified' | null;

export function linkedInBadgeState(
  contact: Pick<SignalLeadContactRow, 'linkedin_url' | 'linkedin_verified'> | null | undefined,
): LinkedInBadgeState {
  if (!contact?.linkedin_url?.trim()) return null;
  return contact.linkedin_verified ? 'verified' : 'unverified';
}
