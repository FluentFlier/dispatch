import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getOrCreateSubscription } from '@/lib/entitlements';
import { getPostAuthPath } from '@/lib/auth-routing';
import { ensureInternalProductAccess } from '@/lib/internal-access';
import { PENDING_TRIAL_CODE_COOKIE } from '@/lib/trial-code-cookie';

/**
 * Post-auth router: redeems a code validated before sign-in, then sends users to
 * profile setup or the app. Direct sign-ins without a code return to /get-started.
 */
export default async function AuthContinuePage() {
  const user = await getAuthenticatedUser();
  if (!user) {
    // Reached here only because a content-os-token cookie exists (middleware sent
    // us). No valid user means it's expired/invalid - route to the ?expired=1
    // escape hatch so middleware lets /login render instead of bouncing us back
    // to /auth/continue in an infinite loop.
    redirect('/login?expired=1');
  }

  // Admin/internal accounts are more privileged than ordinary invitees and
  // must never be sent to the access-code gate.
  await ensureInternalProductAccess(user);

  if (cookies().get(PENDING_TRIAL_CODE_COOKIE)?.value) {
    redirect('/auth/redeem-code');
  }

  const client = getServerClient();
  const [profileRes, sub] = await Promise.all([
    client.database
      .from('creator_profile')
      .select('onboarding_complete')
      .eq('user_id', user.id)
      .maybeSingle(),
    getOrCreateSubscription(user.id),
  ]);

  const nextPath = getPostAuthPath(profileRes.data, sub);

  if (nextPath === '/pricing') {
    redirect('/pricing?trial=expired');
  }

  redirect(nextPath);
}
